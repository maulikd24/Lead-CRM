import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";

import { buildDestination, demoDestinationAllowed, parseDestinationSettings, REAL_FIELDS } from "./config";
import { GLOBAL_PROVIDER, loadGlobalSettings, providerOf } from "./db";
import { eventCoverage, matchRate, summariseStatuses } from "./summary";
import { DESTINATION_KEYS, DESTINATION_LABEL, type DestinationKey } from "./types";
import type { EventType } from "./events";

type Db = typeof prisma;

/**
 * Everything the workspace shows. Aggregates and pseudonymous row ids only: no customer id, name, phone, email or PAN is ever
 * returned from this file, so a Marketing user (who may not see customers) can be given every function in it.
 */

export async function loadOverview(db: Db = prisma, now: Date = new Date()) {
  const [byStatus, byEvent, match, lastSent, consent, coverage] = await Promise.all([
    db.conversionOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    db.conversionOutbox.groupBy({ by: ["eventType"], where: { status: "SENT" }, _count: { _all: true } }),
    db.conversionOutbox.groupBy({ by: ["matched"], where: { status: "SENT", matched: { not: null } }, _count: { _all: true } }),
    db.conversionOutbox.aggregate({ where: { status: "SENT" }, _max: { sentAt: true } }),
    loadConsentFacts(db),
    loadEventCoverage(db),
  ]);
  const matched = match.find((m) => m.matched === true)?._count._all ?? 0;
  const unmatched = match.find((m) => m.matched === false)?._count._all ?? 0;
  return {
    statuses: summariseStatuses(byStatus.map((r) => ({ status: r.status, n: r._count._all }))),
    sentByEvent: Object.fromEntries(byEvent.map((r) => [r.eventType, r._count._all])) as Partial<Record<EventType, number>>,
    match: matchRate({ matched, unmatched }),
    lastSentAt: lastSent._max.sentAt,
    consent,
    coverage,
    asOf: now,
  };
}

/** What the consent ledger says about ad measurement right now: customers whose latest record is a current grant, a withdrawal, or a grant that has lapsed. Counts only. */
export async function loadConsentFacts(db: Db = prisma): Promise<{ agreed: number; withdrawn: number; lapsed: number }> {
  const rows = await db.$queryRaw<{ agreed: number; withdrawn: number; lapsed: number }[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("clientId") "clientId", status, "expiresAt" FROM "ConsentRecord"
      WHERE purpose = 'ADS_MEASUREMENT' AND "capturedAt" <= now()
      ORDER BY "clientId", "capturedAt" DESC, (status = 'WITHDRAWN') DESC)
    SELECT
      (count(*) FILTER (WHERE l.status = 'GRANTED' AND (l."expiresAt" IS NULL OR l."expiresAt" > now())))::int AS agreed,
      (count(*) FILTER (WHERE l.status = 'WITHDRAWN'))::int AS withdrawn,
      (count(*) FILTER (WHERE l.status = 'GRANTED' AND l."expiresAt" IS NOT NULL AND l."expiresAt" <= now()))::int AS lapsed
    FROM latest l JOIN "Client" c ON c.id = l."clientId" WHERE c."isDeleted" = false AND c."mergedIntoId" IS NULL`;
  return rows[0] ?? { agreed: 0, withdrawn: 0, lapsed: 0 };
}

/** The closed loop's own events by state and reason. Counts only. */
export async function loadEventCoverage(db: Db = prisma) {
  const rows = await db.conversionOutbox.groupBy({ by: ["status", "reason"], _count: { _all: true } });
  return eventCoverage(rows.map((r) => ({ status: r.status, reason: r.reason, n: r._count._all })));
}

export const CLOSED_LOOP_APPROVAL_TYPES = ["CLOSED_LOOP_DESTINATION", "CONSENT_POLICY_CHANGE"] as const;

/** Changes waiting for a second Admin (names of the thing and when it was asked; never a payload). */
export async function loadPendingChanges(db: Db = prisma): Promise<{ kind: "destination" | "wording"; subject: string; requestedAt: Date }[]> {
  const rows = await db.approvalRequest.findMany({ where: { status: "PENDING", actionType: { in: [...CLOSED_LOOP_APPROVAL_TYPES] } }, orderBy: { requestedAt: "asc" }, take: 20, select: { actionType: true, entityId: true, requestedAt: true } });
  return rows.map((r) => ({ kind: r.actionType === "CLOSED_LOOP_DESTINATION" ? "destination" : "wording", subject: r.entityId, requestedAt: r.requestedAt }));
}

export type OutboxView = {
  id: string;
  ref: string;
  eventType: EventType;
  destination: DestinationKey;
  status: string;
  reason: string | null;
  attempts: number;
  occurredAt: Date;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  matched: boolean | null;
};

export const OUTBOX_FILTERS = ["all", "waiting", "sent", "failed", "dead", "skipped"] as const;
export type OutboxFilter = (typeof OUTBOX_FILTERS)[number];
const FILTER_STATUS: Record<OutboxFilter, string[] | null> = { all: null, waiting: ["PENDING", "SENDING"], sent: ["SENT"], failed: ["FAILED"], dead: ["DEAD"], skipped: ["SKIPPED"] };

/** Event rows with a short pseudonymous reference (part of the dedup id), never the customer. */
export async function loadOutbox(filter: OutboxFilter = "all", limit = 100, db: Db = prisma): Promise<{ rows: OutboxView[]; total: number }> {
  const statuses = FILTER_STATUS[filter];
  const where: Prisma.ConversionOutboxWhereInput = statuses ? { status: { in: statuses } } : {};
  const [rows, total] = await Promise.all([
    db.conversionOutbox.findMany({
      where, orderBy: { occurredAt: "desc" }, take: limit,
      select: { id: true, eventType: true, destination: true, status: true, reason: true, attempts: true, occurredAt: true, nextAttemptAt: true, sentAt: true, matched: true, dedupId: true },
    }),
    db.conversionOutbox.count({ where }),
  ]);
  return { total, rows: rows.map(({ dedupId, ...r }) => ({ ...r, ref: dedupId.slice(4, 12), eventType: r.eventType as EventType, destination: r.destination as DestinationKey })) };
}

export type DestinationView = {
  key: DestinationKey;
  label: string;
  setUp: boolean;
  enabled: boolean;
  region: string | null;
  allowedRegions: string[];
  sendValue: boolean;
  /** Which credential fields have a value. Never the values. */
  filled: Record<string, boolean>;
  /** The fake is a demo destination and exists only when CLOSED_LOOP_DEMO=1. */
  available: boolean;
};

export async function loadDestinationsView(db: Db = prisma, env: Record<string, string | undefined> = process.env) {
  const rows = await db.integrationConfig.findMany({ where: { provider: { in: DESTINATION_KEYS.map(providerOf) } } });
  const global = await loadGlobalSettings(db);
  const noFetch = async () => ({ status: 0, ok: false, json: async () => ({}) });
  const destinations: DestinationView[] = DESTINATION_KEYS.map((key) => {
    const row = rows.find((r) => r.provider === providerOf(key));
    const credentials = row?.credentials ? decryptJson<Record<string, unknown>>(row.credentials as string) : {};
    const settings = parseDestinationSettings(row?.settings);
    const fields = key === "fake" ? [] : REAL_FIELDS[key];
    return {
      key, label: DESTINATION_LABEL[key], setUp: buildDestination(key, credentials, noFetch, { demo: demoDestinationAllowed(env) }) !== null,
      enabled: settings.enabled, region: settings.region, allowedRegions: settings.allowedRegions, sendValue: settings.sendValue,
      filled: Object.fromEntries(fields.map((f) => [f.key, typeof credentials[f.key] === "string" && String(credentials[f.key]).trim() !== ""])),
      available: key !== "fake" || demoDestinationAllowed(env),
    };
  }).filter((d) => d.available);
  return { destinations, global };
}

export { GLOBAL_PROVIDER };
