import { prisma } from "@/lib/db/prisma";
import { CONSENT_PURPOSES, DND_PURPOSE } from "./policy";

export type PurposeCounts = { purpose: string; granted: number; withdrawn: number; expired: number; notRecorded: number; legacyGranted: number };

type Raw = { purpose: string; granted: number; withdrawn: number; expired: number; customers: number };

/**
 * Current entries per purpose (the latest row for each customer, purpose and channel). Customers whose only consent is the lead-form
 * timestamp are counted as legacy marketing grants. Read-only.
 */
export async function loadConsentCounts(): Promise<PurposeCounts[]> {
  const [raw, totalCustomers, legacyOnly] = await Promise.all([
    prisma.$queryRaw<Raw[]>`
      WITH latest AS (
        SELECT DISTINCT ON ("clientId", purpose, COALESCE(channel, '')) "clientId", purpose, status, "expiresAt"
        FROM "ConsentRecord"
        WHERE "capturedAt" <= now()
        ORDER BY "clientId", purpose, COALESCE(channel, ''), "capturedAt" DESC, (status = 'WITHDRAWN') DESC
      )
      SELECT purpose,
        (COUNT(*) FILTER (WHERE status = 'GRANTED' AND ("expiresAt" IS NULL OR "expiresAt" > now())))::int AS granted,
        (COUNT(*) FILTER (WHERE status = 'WITHDRAWN'))::int AS withdrawn,
        (COUNT(*) FILTER (WHERE status = 'GRANTED' AND "expiresAt" <= now()))::int AS expired,
        (COUNT(DISTINCT "clientId"))::int AS customers
      FROM latest GROUP BY purpose`,
    prisma.client.count({ where: { isDeleted: false, mergedIntoId: null } }),
    prisma.client.count({ where: { isDeleted: false, mergedIntoId: null, marketingConsentAt: { not: null }, consentRecords: { none: { purpose: "MARKETING_COMMS" } } } }),
  ]);
  const by = new Map(raw.map((r) => [r.purpose, r]));
  return [...CONSENT_PURPOSES, DND_PURPOSE].map((purpose) => {
    const r = by.get(purpose);
    const legacyGranted = purpose === "MARKETING_COMMS" ? legacyOnly : 0;
    const known = (r?.customers ?? 0) + legacyGranted;
    return {
      purpose,
      granted: r?.granted ?? 0,
      withdrawn: r?.withdrawn ?? 0,
      expired: r?.expired ?? 0,
      legacyGranted,
      notRecorded: Math.max(0, totalCustomers - known),
    };
  });
}

export async function loadRecentWithdrawals(take = 15) {
  const rows = await prisma.consentRecord.findMany({
    where: { status: "WITHDRAWN" },
    orderBy: { capturedAt: "desc" },
    take,
    select: { id: true, purpose: true, channel: true, source: true, capturedAt: true, client: { select: { id: true, clientCode: true } } },
  });
  return rows.map((r) => ({ id: r.id, purpose: r.purpose, channel: r.channel, source: r.source, at: r.capturedAt, clientId: r.client.id, clientCode: r.client.clientCode }));
}
