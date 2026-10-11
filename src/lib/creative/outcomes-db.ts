import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isAdChannel, type AdChannel } from "@/lib/marketing/channels";
import type { CreativeDayRow } from "@/lib/marketing/creatives";
import { addDays } from "@/lib/marketing/dates";
import { loadMarketingWorkspace } from "@/lib/marketing/report";
import { netRevenue } from "@/lib/marketing/revenue";

import { attributeLeadsToAds, createSimpleOutcomeProvider, type AdLead, type CampaignOutcomeProvider, type SimpleOutcomeDeps } from "./outcomes";

/**
 * The database wiring of the simple outcome provider. When the attribution module lands, this factory returns ITS
 * implementation of CampaignOutcomeProvider instead; nothing else changes. Aggregates only: no customer data leaves here.
 */

const day = (d: Date) => d.toISOString().slice(0, 10);
const startOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

async function loadAdDaily(from: string, to: string): Promise<CreativeDayRow[]> {
  const rows = await prisma.adCreativeDaily.findMany({ where: { date: { gte: startOf(from), lte: startOf(to) } }, take: 100_000 });
  return rows.flatMap((r) => (isAdChannel(r.provider) ? [{ channel: r.provider, campaignId: r.campaignId, campaignName: r.campaignName, adId: r.adId, adName: r.adName, format: r.format, date: day(r.date), spendMinor: Number(r.spendMinor), currency: r.currency, impressions: r.impressions, clicks: r.clicks, leads: r.leads }] : []));
}

async function loadAdLeads(from: string, to: string): Promise<AdLead[]> {
  const ads = new Map<string, string>();
  for (const r of await loadAdDaily(from, to)) ads.set(r.adId, r.adName);
  if (ads.size === 0) return [];
  const clients = await prisma.client.findMany({
    where: { isDeleted: false, mergedIntoId: null, leadAttribution: { not: Prisma.DbNull }, createdAt: { gte: startOf(addDays(from, -1)), lt: startOf(addDays(to, 2)) } },
    orderBy: { createdAt: "desc" },
    take: 20_000,
    select: {
      leadAttribution: true,
      kycRecord: { select: { status: true } },
      fundingRecord: { select: { status: true } },
      payments: { where: { paymentType: "FUNDS_IN", status: "SUCCESS" }, select: { id: true }, take: 1 },
      revenueEvents: { select: { id: true, revenueType: true, grossRevenueAmount: true, reversesEventId: true, reverses: { select: { revenueType: true } } } },
    },
  });
  return attributeLeadsToAds(
    clients.map((c) => ({
      attribution: c.leadAttribution && typeof c.leadAttribution === "object" && !Array.isArray(c.leadAttribution) ? (c.leadAttribution as Record<string, unknown>) : null,
      kycApproved: c.kycRecord?.status === "APPROVED",
      funded: c.fundingRecord?.status === "PARTIALLY_FUNDED" || c.fundingRecord?.status === "FULLY_FUNDED" || c.payments.length > 0,
      revenue: netRevenue(c.revenueEvents.map((e) => ({ id: e.id, revenueType: e.revenueType, amount: Number(e.grossRevenueAmount), reversesEventId: e.reversesEventId, reversedType: e.reverses?.revenueType ?? null }))),
    })),
    [...ads].map(([adId, adName]) => ({ adId, adName })),
  );
}

async function lastSync(channel: AdChannel): Promise<Date | null> {
  const run = await prisma.adSyncRun.findFirst({ where: { provider: channel, status: "SUCCESS" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true } });
  return run ? (run.finishedAt ?? run.startedAt) : null;
}

export const simpleOutcomeDeps: SimpleOutcomeDeps = {
  async loadReports(from, to) {
    const ws = await loadMarketingWorkspace(() => ({ from, to, preset: "custom" }));
    return Promise.all(ws.channels.map(async (c) => ({ channel: c.channel, report: c.report, asOf: c.report ? await lastSync(c.channel) : null })));
  },
  loadAdDaily,
  async loadCampaignDaily(from, to) {
    const rows = await prisma.adCampaignDaily.findMany({ where: { date: { gte: startOf(from), lte: startOf(to) } }, take: 100_000 });
    return rows.flatMap((r) => (isAdChannel(r.provider) ? [{ channel: r.provider, campaignId: r.campaignId, campaignName: r.campaignName, date: day(r.date), spendMinor: Number(r.spendMinor), currency: r.currency, impressions: r.impressions, clicks: r.clicks, reach: r.reach, leads: r.leads }] : []));
  },
  loadAdLeads,
};

export function getOutcomeProvider(): CampaignOutcomeProvider {
  return createSimpleOutcomeProvider(simpleOutcomeDeps);
}
