import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";

import { buildDestination, demoDestinationAllowed, parseDestinationSettings, REAL_FIELDS } from "./config";
import { GLOBAL_PROVIDER, loadGlobalSettings, providerOf } from "./db";
import { campaignLabel, coverageShare, matchRate, summariseStatuses } from "./summary";
import { DESTINATION_KEYS, DESTINATION_LABEL, type DestinationKey } from "./types";
import type { EventType } from "./events";

type Db = typeof prisma;

/**
 * Everything the workspace shows. Aggregates and pseudonymous row ids only: no customer id, name, phone, email or PAN is ever
 * returned from this file, so a Marketing user (who may not see customers) can be given every function in it.
 */

export async function loadOverview(db: Db = prisma, now: Date = new Date()) {
  const [byStatus, byEvent, match, lastSent, fundedConsent] = await Promise.all([
    db.conversionOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
    db.conversionOutbox.groupBy({ by: ["eventType"], where: { status: "SENT" }, _count: { _all: true } }),
    db.conversionOutbox.groupBy({ by: ["matched"], where: { status: "SENT", matched: { not: null } }, _count: { _all: true } }),
    db.conversionOutbox.aggregate({ where: { status: "SENT" }, _max: { sentAt: true } }),
    loadFundedConsentSplit(db),
  ]);
  const matched = match.find((m) => m.matched === true)?._count._all ?? 0;
  const unmatched = match.find((m) => m.matched === false)?._count._all ?? 0;
  return {
    statuses: summariseStatuses(byStatus.map((r) => ({ status: r.status, n: r._count._all }))),
    sentByEvent: Object.fromEntries(byEvent.map((r) => [r.eventType, r._count._all])) as Partial<Record<EventType, number>>,
    match: matchRate({ matched, unmatched }),
    lastSentAt: lastSent._max.sentAt,
    funded: fundedConsent,
    asOf: now,
  };
}

/** Funded customers split by whether they currently have ad measurement consent. Counts only. */
export async function loadFundedConsentSplit(db: Db = prisma): Promise<{ funded: number; consented: number; notConsented: number }> {
  const rows = await db.$queryRaw<{ funded: number; consented: number }[]>`
    WITH funded AS (
      SELECT c.id FROM "Client" c JOIN "FundingRecord" f ON f."clientId" = c.id
      WHERE c."isDeleted" = false AND c."mergedIntoId" IS NULL AND f.status IN ('PARTIALLY_FUNDED', 'FULLY_FUNDED')),
    latest AS (
      SELECT DISTINCT ON ("clientId") "clientId", status, "expiresAt" FROM "ConsentRecord"
      WHERE purpose = 'ADS_MEASUREMENT' AND "capturedAt" <= now()
      ORDER BY "clientId", "capturedAt" DESC, (status = 'WITHDRAWN') DESC)
    SELECT count(*)::int AS funded,
      (count(*) FILTER (WHERE l.status = 'GRANTED' AND (l."expiresAt" IS NULL OR l."expiresAt" > now())))::int AS consented
    FROM funded fu LEFT JOIN latest l ON l."clientId" = fu.id`;
  const r = rows[0] ?? { funded: 0, consented: 0 };
  return { funded: r.funded, consented: r.consented, notConsented: r.funded - r.consented };
}

export type CoverageRow = { campaign: string; funded: number; consented: number; sendable: number; share: number | null; small: boolean };

/** Of funded customers, who could be sent, by the campaign on their lead. Sendable = consented now AND at least one identifier to match on. */
export async function loadCoverageByCampaign(db: Db = prisma): Promise<CoverageRow[]> {
  const rows = await db.$queryRaw<{ campaign: string; funded: number; consented: number; sendable: number }[]>`
    WITH funded AS (
      SELECT c.id, COALESCE(NULLIF(btrim(c."leadAttribution"->>'campaign'), ''), '') AS campaign,
        (c."emailKey" IS NOT NULL OR c."mobileKey" IS NOT NULL OR c."leadAttribution"->>'gclid' IS NOT NULL OR c."leadAttribution"->>'fbclid' IS NOT NULL OR c."leadAttribution"->>'fbp' IS NOT NULL) AS has_id
      FROM "Client" c JOIN "FundingRecord" f ON f."clientId" = c.id
      WHERE c."isDeleted" = false AND c."mergedIntoId" IS NULL AND f.status IN ('PARTIALLY_FUNDED', 'FULLY_FUNDED')),
    latest AS (
      SELECT DISTINCT ON ("clientId") "clientId", status, "expiresAt" FROM "ConsentRecord"
      WHERE purpose = 'ADS_MEASUREMENT' AND "capturedAt" <= now()
      ORDER BY "clientId", "capturedAt" DESC, (status = 'WITHDRAWN') DESC),
    joined AS (
      SELECT fu.campaign, fu.has_id, (l.status = 'GRANTED' AND (l."expiresAt" IS NULL OR l."expiresAt" > now())) AS ok
      FROM funded fu LEFT JOIN latest l ON l."clientId" = fu.id)
    SELECT campaign, count(*)::int AS funded, (count(*) FILTER (WHERE ok))::int AS consented, (count(*) FILTER (WHERE ok AND has_id))::int AS sendable
    FROM joined GROUP BY campaign ORDER BY count(*) DESC, campaign LIMIT 200`;
  return rows.map((r) => {
    const s = coverageShare({ funded: r.funded, sendable: r.sendable });
    return { campaign: campaignLabel(r.campaign), funded: r.funded, consented: r.consented, sendable: r.sendable, share: s?.share ?? null, small: s?.small ?? false };
  });
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
