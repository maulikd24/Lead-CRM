import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

import { blendReports, type BlendedReport } from "./blend";
import { AD_CHANNELS, CHANNEL_LABEL, type AdChannel } from "./channels";
import { getMetaAdsConfig, metaAdsSyncEnabled } from "./config";
import { getGoogleAdsConfig, googleAdsReportingEnabled } from "./config-google";
import { addDays, todayInTimeZone } from "./dates";
import { buildReport, type AdDayRow, type MarketingReport, type OutcomeLead } from "./metrics";
import { netRevenue } from "./revenue";
import { connectionView, type ConnectionView, type DateRange } from "./view-model";

/** Database loading for the Marketing page. Aggregates only: no names, contact details or client ids leave this module. */

const LEAD_LIMIT = 20_000;
const FALLBACK_TIMEZONE = "UTC";
const TIE_LOOKBACK = 3;
const CACHE_MS = 60_000;

const cache = new Map<string, { at: number; report: MarketingReport }>();
export function clearMarketingCache() {
  cache.clear();
}

export type LastRunView = { status: string; startedAt: Date; finishedAt: Date | null; error: string | null; rowsUpserted: number; windowsOk: number; windowsFailed: number } | null;

export type MarketingPageData = {
  today: string;
  range: DateRange;
  timezone: string;
  connection: ConnectionView;
  report: MarketingReport | null;
  lastRun: LastRunView;
};

/** The channel id doubles as the provider id stored in AdCampaignDaily and AdSyncRun. */
const providerOf = (channel: AdChannel): string => channel;

export async function getAdAccountTimezone(channel: AdChannel = "meta"): Promise<string> {
  const row = await prisma.adCampaignDaily.findFirst({ where: { provider: providerOf(channel) }, orderBy: { syncedAt: "desc" }, select: { accountTimezone: true } });
  return row?.accountTimezone ?? FALLBACK_TIMEZONE;
}

const WORDING: Record<AdChannel, { label: string; syncFlag: string }> = {
  meta: { label: CHANNEL_LABEL.meta, syncFlag: "META_ADS_SYNC_ENABLED" },
  google: { label: CHANNEL_LABEL.google, syncFlag: "GOOGLE_ADS_REPORTING_ENABLED" },
};

async function channelSwitches(channel: AdChannel): Promise<{ live: boolean; syncEnabled: boolean }> {
  if (channel === "google") {
    const config = await getGoogleAdsConfig().catch(() => ({ live: false }));
    return { live: config.live, syncEnabled: googleAdsReportingEnabled() };
  }
  const config = await getMetaAdsConfig().catch(() => ({ live: false }));
  return { live: config.live, syncEnabled: metaAdsSyncEnabled() };
}

export async function getConnectionState(now: Date, channel: AdChannel = "meta") {
  const provider = providerOf(channel);
  const { live, syncEnabled } = await channelSwitches(channel);
  const [lastRun, lastSuccess, anyData] = await Promise.all([
    prisma.adSyncRun.findFirst({ where: { provider }, orderBy: { startedAt: "desc" } }),
    prisma.adSyncRun.findFirst({ where: { provider, status: "SUCCESS" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.adCampaignDaily.findFirst({ where: { provider }, select: { id: true } }),
  ]);
  return {
    lastRun,
    connection: connectionView({
      channel: WORDING[channel],
      live,
      syncEnabled,
      hasData: anyData !== null,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      lastRun: lastRun ? { status: lastRun.status, error: lastRun.error, startedAt: lastRun.startedAt } : null,
      now,
    }),
  };
}

type LeadRow = Awaited<ReturnType<typeof loadLeadRows>>["clients"][number];
type SharedLeads = { clients: LeadRow[]; aum: Map<string, number> };

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

/** One lead query serves every channel: matching by channel happens later, in memory. */
async function loadLeadRows(from: string, to: string) {
  // Pad the creation window by a day each side so the account-timezone day filter in buildReport is exact.
  const clients = await prisma.client.findMany({
    where: {
      isDeleted: false,
      mergedIntoId: null,
      leadAttribution: { not: Prisma.DbNull },
      createdAt: { gte: new Date(`${addDays(from, -1)}T00:00:00Z`), lt: new Date(`${addDays(to, 2)}T00:00:00Z`) },
    },
    orderBy: { createdAt: "desc" }, // newest first: if the limit is hit, the oldest leads are the ones left out
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
      revenueEvents: { select: { id: true, revenueType: true, grossRevenueAmount: true, reversesEventId: true, reverses: { select: { revenueType: true } } } },
    },
  });
  return { clients };
}

async function loadSharedLeads(from: string, to: string): Promise<SharedLeads> {
  const { clients } = await loadLeadRows(from, to);
  return { clients, aum: await aumByClient(clients.map((c) => c.id)) };
}

async function buildChannelReport(channel: AdChannel, from: string, to: string, timezone: string, shared: () => Promise<SharedLeads>): Promise<MarketingReport> {
  const provider = providerOf(channel);
  const leadIn = addDays(from, -TIE_LOOKBACK);
  const [adRows, identities, firstDay, { clients, aum }] = await Promise.all([
    prisma.adCampaignDaily.findMany({ where: { provider, date: { gte: new Date(`${leadIn}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } } }),
    prisma.adCampaignDaily.groupBy({ by: ["campaignId", "campaignName"], where: { provider }, _max: { date: true } }),
    prisma.adCampaignDaily.aggregate({ where: { provider }, _min: { date: true } }),
    shared(),
  ]);
  const adHistoryStart = firstDay._min.date ? firstDay._min.date.toISOString().slice(0, 10) : null;
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
  // Every distinct (id, name) pair is kept, so a renamed campaign still matches leads that carry its old name.
  const identityList = identities.map((i) => ({ campaignId: i.campaignId, campaignName: i.campaignName }));

  const leads: OutcomeLead[] = clients.map((c) => ({
    clientId: c.id,
    day: todayInTimeZone(c.createdAt, timezone),
    leadSource: c.leadSource,
    attribution: c.leadAttribution && typeof c.leadAttribution === "object" && !Array.isArray(c.leadAttribution) ? (c.leadAttribution as Record<string, unknown>) : null,
    kycApproved: c.kycRecord?.status === "APPROVED",
    funded: c.fundingRecord?.status === "PARTIALLY_FUNDED" || c.fundingRecord?.status === "FULLY_FUNDED" || c.payments.length > 0,
    firstTransaction: c.tradingAccounts.some((t) => t.transactions.length > 0),
    aum: aum.get(c.id) ?? 0,
    revenue: netRevenue(
      c.revenueEvents.map((e) => ({ id: e.id, revenueType: e.revenueType, amount: Number(e.grossRevenueAmount), reversesEventId: e.reversesEventId, reversedType: e.reverses?.revenueType ?? null })),
    ),
  }));

  const report = buildReport({ from, to, channel, adHistoryStart, ads, identities: identityList, leads });
  if (clients.length >= LEAD_LIMIT) report.notes.push({ tone: "warning", text: `Showing the most recent ${LEAD_LIMIT.toLocaleString("en-US")} leads in the range; older leads were left out. Pick a shorter range for exact numbers.` });
  return report;
}

function lastRunView(lastRun: Awaited<ReturnType<typeof getConnectionState>>["lastRun"]): LastRunView {
  return lastRun ? { status: lastRun.status, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt, error: lastRun.error, rowsUpserted: lastRun.rowsUpserted, windowsOk: lastRun.windowsOk, windowsFailed: lastRun.windowsFailed } : null;
}

async function cachedReport(channel: AdChannel, from: string, to: string, timezone: string, now: Date, shared: () => Promise<SharedLeads>): Promise<MarketingReport> {
  const key = `${channel}|${from}|${to}`;
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.report;
  const report = await buildChannelReport(channel, from, to, timezone, shared);
  cache.set(key, { at: now.getTime(), report });
  return report;
}

/** Single-channel (Meta) loader, kept for callers that only want one channel. */
export async function loadMarketingPage(pickRange: (today: string) => DateRange, now = new Date(), channel: AdChannel = "meta"): Promise<MarketingPageData> {
  const timezone = await getAdAccountTimezone(channel);
  const today = todayInTimeZone(now, timezone);
  const range = pickRange(today);
  const { connection, lastRun } = await getConnectionState(now, channel);
  const view = lastRunView(lastRun);
  if (connection.state === "not_connected") return { today, range, timezone, connection, report: null, lastRun: view };
  let shared: Promise<SharedLeads> | null = null;
  const report = await cachedReport(channel, range.from, range.to, timezone, now, () => (shared ??= loadSharedLeads(range.from, range.to)));
  return { today, range, timezone, connection, report, lastRun: view };
}

export type ChannelData = { channel: AdChannel; label: string; timezone: string; connection: ConnectionView; lastRun: LastRunView; report: MarketingReport | null };

export type WorkspaceData = {
  today: string;
  range: DateRange;
  /** The timezone "today" and the range are counted in: the first connected channel's account timezone. */
  timezone: string;
  channels: ChannelData[];
  blended: BlendedReport | null;
};

/** Every channel that is switched on, with one shared lead query, plus the blended view. Google is skipped entirely when its flag is off. */
export async function loadMarketingWorkspace(pickRange: (today: string) => DateRange, now = new Date()): Promise<WorkspaceData> {
  const active = AD_CHANNELS.filter((c) => c === "meta" || googleAdsReportingEnabled());
  const states = await Promise.all(
    active.map(async (channel) => {
      const [timezone, state] = await Promise.all([getAdAccountTimezone(channel), getConnectionState(now, channel)]);
      return { channel, timezone, ...state };
    }),
  );
  const primary = states.find((s) => s.connection.state !== "not_connected") ?? states[0];
  const timezone = primary?.timezone ?? FALLBACK_TIMEZONE;
  const today = todayInTimeZone(now, timezone);
  const range = pickRange(today);

  let shared: Promise<SharedLeads> | null = null;
  const loadShared = () => (shared ??= loadSharedLeads(range.from, range.to));
  const channels: ChannelData[] = await Promise.all(
    states.map(async (s) => ({
      channel: s.channel,
      label: CHANNEL_LABEL[s.channel],
      timezone: s.timezone,
      connection: s.connection,
      lastRun: lastRunView(s.lastRun),
      report: s.connection.state === "not_connected" ? null : await cachedReport(s.channel, range.from, range.to, s.timezone, now, loadShared),
    })),
  );
  const reports = Object.fromEntries(channels.flatMap((c) => (c.report ? [[c.channel, c.report] as const] : [])));
  return { today, range, timezone, channels, blended: channels.some((c) => c.report) ? blendReports(reports) : null };
}
