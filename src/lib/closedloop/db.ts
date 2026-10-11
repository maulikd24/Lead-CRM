import { Prisma } from "@/generated/prisma/client";
import type { ConsentRow } from "@/lib/consent/decision";
import { prisma } from "@/lib/db/prisma";
import { decryptJson } from "@/lib/security/crypto";

import { buildDestination, demoDestinationAllowed, parseDestinationSettings, parseGlobalSettings, type GlobalSettings } from "./config";
import type { ClientFacts } from "./events";
import type { Candidate } from "./produce";
import type { FetchLike } from "./adapters/meta-capi";
import type { DestinationContext, DestinationKey, NewOutboxRow, OutboxRow, OutboxStore } from "./types";
import { DESTINATION_KEYS } from "./types";

/** IntegrationConfig providers used by this module. Credentials are encrypted at rest like every other integration. */
export const providerOf = (key: DestinationKey) => `closedloop_${key}`;
export const GLOBAL_PROVIDER = "closedloop_global";

type Db = typeof prisma;
type Row = Awaited<ReturnType<Db["conversionOutbox"]["findFirstOrThrow"]>>;

const toRow = (r: Row): OutboxRow => ({
  id: r.id, clientId: r.clientId, destination: r.destination as DestinationKey, eventType: r.eventType as OutboxRow["eventType"], qualifier: r.qualifier, dedupId: r.dedupId,
  occurredAt: r.occurredAt, status: r.status as OutboxRow["status"], reason: r.reason, attempts: r.attempts, nextAttemptAt: r.nextAttemptAt, claimedAt: r.claimedAt, sentAt: r.sentAt,
  lastError: r.lastError, matched: r.matched, identity: (r.identity ?? {}) as OutboxRow["identity"], value: r.value, createdAt: r.createdAt,
});

/** The Prisma-backed outbox. Claiming is one conditional UPDATE, so two overlapping runs can never both send a row. */
export function createPrismaOutbox(db: Db = prisma): OutboxStore {
  const dueWhere = (now: Date, staleBefore: Date): Prisma.ConversionOutboxWhereInput => ({
    OR: [{ status: "PENDING" }, { status: "FAILED", nextAttemptAt: { lte: now } }, { status: "SENDING", claimedAt: { lt: staleBefore } }],
  });
  return {
    async insertIfAbsent(row: NewOutboxRow) {
      const r = await db.conversionOutbox.createMany({
        data: [{ clientId: row.clientId, destination: row.destination, eventType: row.eventType, qualifier: row.qualifier, dedupId: row.dedupId, occurredAt: row.occurredAt, status: row.status ?? "PENDING", reason: row.reason ?? null, identity: row.identity as Prisma.InputJsonValue, value: row.value }],
        skipDuplicates: true,
      });
      return { created: r.count === 1 };
    },
    async due(now, staleBefore, limit) {
      return (await db.conversionOutbox.findMany({ where: dueWhere(now, staleBefore), orderBy: { occurredAt: "asc" }, take: limit })).map(toRow);
    },
    async claim(id, now, staleBefore) {
      const r = await db.conversionOutbox.updateMany({ where: { id, ...dueWhere(now, staleBefore) }, data: { status: "SENDING", claimedAt: now, attempts: { increment: 1 } } });
      if (r.count !== 1) return null;
      return toRow(await db.conversionOutbox.findUniqueOrThrow({ where: { id } }));
    },
    async markSent(id, now, matched) {
      await db.conversionOutbox.update({ where: { id }, data: { status: "SENT", sentAt: now, matched, nextAttemptAt: null, lastError: null, reason: null } });
    },
    async markRetry(id, nextAttemptAt, error) {
      await db.conversionOutbox.update({ where: { id }, data: { status: "FAILED", nextAttemptAt, lastError: error.slice(0, 80), reason: error.slice(0, 80) } });
    },
    async markDead(id, error) {
      await db.conversionOutbox.update({ where: { id }, data: { status: "DEAD", lastError: error.slice(0, 80), reason: error.slice(0, 80), nextAttemptAt: null } });
    },
    async markSkipped(id, reason) {
      await db.conversionOutbox.update({ where: { id }, data: { status: "SKIPPED", reason, nextAttemptAt: null } });
    },
    async requeue(id) {
      const r = await db.conversionOutbox.updateMany({ where: { id, status: { in: ["DEAD", "FAILED"] } }, data: { status: "PENDING", attempts: 0, nextAttemptAt: null, lastError: null, reason: null } });
      return r.count === 1;
    },
    async cancelUnsentForClient(clientId, reason) {
      const r = await db.conversionOutbox.updateMany({ where: { clientId, status: { in: ["PENDING", "FAILED", "SENDING"] } }, data: { status: "SKIPPED", reason, nextAttemptAt: null } });
      return r.count;
    },
  };
}

/** Ad measurement ledger rows only, for many customers in one read. A customer with none maps to an empty list. */
export async function loadAdsConsent(clientIds: string[], db: Db = prisma): Promise<Map<string, ConsentRow[]>> {
  const out = new Map<string, ConsentRow[]>(clientIds.map((id) => [id, []]));
  if (clientIds.length === 0) return out;
  const rows = await db.consentRecord.findMany({
    where: { clientId: { in: clientIds }, purpose: "ADS_MEASUREMENT" },
    select: { clientId: true, id: true, purpose: true, channel: true, status: true, capturedAt: true, expiresAt: true },
  });
  for (const { clientId, ...row } of rows) out.get(clientId)?.push(row);
  return out;
}

const QUALIFYING_FUNDING = ["PARTIALLY_FUNDED", "FULLY_FUNDED"] as const;

/** Latest-snapshot assets per customer (sum of each account's most recent holdings date). */
async function loadAum(clientIds: string[], db: Db): Promise<Map<string, { aum: number; asOf: Date }>> {
  const out = new Map<string, { aum: number; asOf: Date }>();
  if (clientIds.length === 0) return out;
  const rows = await db.$queryRaw<{ clientId: string; aum: number; asOf: Date }[]>`
    WITH latest AS (SELECT "tradingAccountId", MAX("asOfDate") AS d FROM "Position" GROUP BY "tradingAccountId")
    SELECT ta."clientId" AS "clientId", COALESCE(SUM(p."currentValue"), 0)::float8 AS aum, MAX(p."asOfDate") AS "asOf"
    FROM "Position" p JOIN latest l ON l."tradingAccountId" = p."tradingAccountId" AND l.d = p."asOfDate"
    JOIN "TradingAccount" ta ON ta.id = p."tradingAccountId"
    WHERE ta."clientId" IN (${Prisma.join(clientIds)}) GROUP BY ta."clientId"`;
  for (const r of rows) out.set(r.clientId, { aum: Number(r.aum), asOf: r.asOf });
  return out;
}

/**
 * Customers who have EVER granted ad measurement (nobody else is read at all) and whose KYC or funding changed inside the
 * look-back window, or who may have reached an assets band. Never deleted or merged-away records. At most `limit` per run.
 */
export async function loadCandidates(now: Date, opts: { lookbackDays: number; bands: boolean; limit?: number }, db: Db = prisma): Promise<Candidate[]> {
  const since = new Date(now.getTime() - opts.lookbackDays * 86_400_000);
  const clients = await db.client.findMany({
    where: {
      isDeleted: false,
      mergedIntoId: null,
      consentRecords: { some: { purpose: "ADS_MEASUREMENT", status: "GRANTED" } },
      OR: [
        { kycRecord: { is: { status: "APPROVED", completionDate: { gte: since } } } },
        { fundingRecord: { is: { status: { in: [...QUALIFYING_FUNDING] }, fundingDate: { gte: since } } } },
        ...(opts.bands ? [{ tradingAccounts: { some: {} } }] : []),
      ],
    },
    orderBy: { id: "asc" },
    take: opts.limit ?? 500,
    select: {
      id: true, email: true, mobile: true, leadAttribution: true, createdAt: true,
      kycRecord: { select: { status: true, completionDate: true } },
      fundingRecord: { select: { status: true, fundingDate: true, amount: true } },
    },
  });
  const aum = opts.bands ? await loadAum(clients.map((c) => c.id), db) : new Map<string, { aum: number; asOf: Date }>();
  return clients.map((c): Candidate => {
    const facts: ClientFacts = {
      clientId: c.id,
      kyc: c.kycRecord ? { status: c.kycRecord.status, completionDate: c.kycRecord.completionDate } : null,
      funding: c.fundingRecord ? { status: c.fundingRecord.status, fundingDate: c.fundingRecord.fundingDate, amount: c.fundingRecord.amount == null ? null : Number(c.fundingRecord.amount) } : null,
      aum: aum.get(c.id)?.aum ?? null,
      aumAsOf: aum.get(c.id)?.asOf ?? null,
    };
    const attribution = c.leadAttribution && typeof c.leadAttribution === "object" && !Array.isArray(c.leadAttribution) ? (c.leadAttribution as Record<string, unknown>) : null;
    return { facts, email: c.email, mobile: c.mobile, attribution, clientCreatedAt: c.createdAt };
  });
}

export async function loadGlobalSettings(db: Db = prisma): Promise<GlobalSettings> {
  const row = await db.integrationConfig.findUnique({ where: { provider: GLOBAL_PROVIDER } });
  return parseGlobalSettings(row?.settings);
}

/** Destinations that are set up (credentials complete) with their stored settings. A destination missing from the map counts as not set up. */
export async function loadDestinationContexts(fetch: FetchLike, env: Record<string, string | undefined> = process.env, db: Db = prisma): Promise<Map<string, DestinationContext>> {
  const rows = await db.integrationConfig.findMany({ where: { provider: { in: DESTINATION_KEYS.map(providerOf) } } });
  const out = new Map<string, DestinationContext>();
  for (const key of DESTINATION_KEYS) {
    const row = rows.find((r) => r.provider === providerOf(key));
    const credentials = row?.credentials ? decryptJson<Record<string, unknown>>(row.credentials as string) : {};
    const destination = buildDestination(key, credentials, fetch, { demo: demoDestinationAllowed(env) });
    if (destination) out.set(key, { destination, settings: parseDestinationSettings(row?.settings) });
  }
  return out;
}
