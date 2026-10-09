import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

import { AD_PROVIDER } from "./sync-core";
import { getMetaAdsConfig, metaAdsSyncEnabled } from "./config";
import { addDays, todayInTimeZone } from "./dates";
import { buildReport, type AdDayRow, type MarketingReport, type OutcomeLead } from "./metrics";
import { connectionView, type ConnectionView } from "./view-model";

/** Database loading for the Marketing page. Aggregates only: no names, contact details or client ids leave this module. */

const LEAD_LIMIT = 20_000;
const FALLBACK_TIMEZONE = "UTC";
const TIE_LOOKBACK = 3;

export type MarketingPageData = {
  today: string;
  timezone: string;
  connection: ConnectionView;
  report: MarketingReport | null;
  lastRun: { status: string; startedAt: Date; finishedAt: Date | null; error: string | null; rowsUpserted: number; windowsOk: number; windowsFailed: number } | null;
};

export async function getAdAccountTimezone(): Promise<string> {
  const row = await prisma.adCampaignDaily.findFirst({ where: { provider: AD_PROVIDER }, orderBy: { syncedAt: "desc" }, select: { accountTimezone: true } });
  return row?.accountTimezone ?? FALLBACK_TIMEZONE;
}

export async function getConnectionState(now: Date) {
  const config = await getMetaAdsConfig().catch(() => ({ live: false }));
  const [lastRun, lastSuccess, anyData] = await Promise.all([
    prisma.adSyncRun.findFirst({ where: { provider: AD_PROVIDER }, orderBy: { startedAt: "desc" } }),
    prisma.adSyncRun.findFirst({ where: { provider: AD_PROVIDER, status: "SUCCESS" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.adCampaignDaily.findFirst({ where: { provider: AD_PROVIDER }, select: { id: true } }),
  ]);
  return {
    lastRun,
    connection: connectionView({
      live: config.live,
      syncEnabled: metaAdsSyncEnabled(),
      hasData: anyData !== null,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      lastRun: lastRun ? { status: lastRun.status, error: lastRun.error, startedAt: lastRun.startedAt } : null,
      now,
    }),
  };
}

/** Latest holdings snapshot per trading account, summed per client. */
async function aumByClient(clientIds: string[]): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ clientId: string; aum: Prisma.Decimal | null }[]>(Prisma.sql`
    SELECT ta."clientId" AS "clientId", SUM(p."currentValue") AS aum
    FROM "Position" p
    JOIN "TradingAccount" ta ON ta."id" = p."tradingAccountId"
    WHERE ta."clientId" = ANY(${clientIds}::text[])
      AND p."asOfDate" = (SELECT MAX(p2."asOfDate") FROM "Position" p2 WHERE p2."tradingAccountId" = p."tradingAccountId")
    GROUP BY ta."clientId"`);
  return new Map(rows.map((r) => [r.clientId, Number(r.aum ?? 0)]));
}

export async function loadMarketingPage(range: { from: string; to: string } | ((today: string) => { from: string; to: string }), now = new Date()): Promise<MarketingPageData> {
  const timezone = await getAdAccountTimezone();
  const today = todayInTimeZone(now, timezone);
  const { from, to } = typeof range === "function" ? range(today) : range;
  const { connection, lastRun } = await getConnectionState(now);
  const lastRunView = lastRun
    ? { status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, error: lastRun.error, rowsUpserted: lastRun.rowsUpserted, windowsOk: lastRun.windowsOk, windowsFailed: lastRun.windowsFailed }
    : null;
  if (connection.state === "not_connected") return { today, timezone, connection, report: null, lastRun: lastRunView };

  const leadIn = addDays(from, -TIE_LOOKBACK);
  const [adRows, identities] = await Promise.all([
    prisma.adCampaignDaily.findMany({ where: { provider: AD_PROVIDER, date: { gte: new Date(`${leadIn}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } }),
    prisma.adCampaignDaily.groupBy({ by: ["campaignId", "campaignName"], where: { provider: AD_PROVIDER }, _max: { date: true } }),
  ]);
  const ads: AdDayRow[] = adRows.map((r) => ({
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    date: r.date.toISOString().slice(0, 10),
    spendMinor: Number(r.spendMinor),
    currency: r.currency,
    impressions: r.impressions,
    clicks: r.clicks,
    reach: r.reach,
    leads: r.leads,
  }));
  // One identity per campaign: the most recent name wins (a renamed campaign keeps its id, and old names stay matchable through the id).
  const latest = new Map<string, { name: string; date: number }>();
  for (const i of identities) {
    const t = i._max.date?.getTime() ?? 0;
    const prev = latest.get(i.campaignId);
    if (!prev || t >= prev.date) latest.set(i.campaignId, { name: i.campaignName, date: t });
  }
  const identityList = [...latest.entries()].map(([campaignId, v]) => ({ campaignId, campaignName: v.name }));

  // Pad the creation window by a day each side so the account-timezone day filter in buildReport is exact.
  const clients = await prisma.client.findMany({
    where: {
      isDeleted: false,
      mergedIntoId: null,
      leadAttribution: { not: Prisma.DbNull },
      createdAt: { gte: new Date(`${addDays(from, -1)}T00:00:00Z`), lt: new Date(`${addDays(to, 2)}T00:00:00Z`) },
    },
    orderBy: { createdAt: "asc" },
    take: LEAD_LIMIT,
    select: {
      id: true,
      createdAt: true,
      leadSource: true,
      leadAttribution: true,
      kycRecord: { select: { status: true } },
      fundingRecord: { select: { status: true } },
      payments: { where: { paymentType: "FUNDS_IN", status: "SUCCESS" }, select: { id: true }, take: 1 },
      tradingAccounts: { select: { transactions: { select: { id: true }, take: 1 } } },
      revenueEvents: { select: { grossRevenueAmount: true } },
    },
  });
  const aum = await aumByClient(clients.map((c) => c.id));

  const leads: OutcomeLead[] = clients.map((c) => ({
    clientId: c.id,
    day: todayInTimeZone(c.createdAt, timezone),
    leadSource: c.leadSource,
    attribution: c.leadAttribution && typeof c.leadAttribution === "object" && !Array.isArray(c.leadAttribution) ? (c.leadAttribution as Record<string, unknown>) : null,
    kycApproved: c.kycRecord?.status === "APPROVED",
    funded: c.fundingRecord?.status === "PARTIALLY_FUNDED" || c.fundingRecord?.status === "FULLY_FUNDED" || c.payments.length > 0,
    firstTransaction: c.tradingAccounts.some((t) => t.transactions.length > 0),
    aum: aum.get(c.id) ?? 0,
    revenue: c.revenueEvents.reduce((sum, e) => sum + Number(e.grossRevenueAmount), 0),
  }));

  const report = buildReport({ from, to, ads, identities: identityList, leads });
  if (clients.length >= LEAD_LIMIT) report.notes.push(`Only the first ${LEAD_LIMIT} leads in the range were read; pick a shorter range for exact numbers.`);
  return { today, timezone, connection, report, lastRun: lastRunView };
}
