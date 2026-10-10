import { prisma } from "@/lib/db/prisma";

import { isAdChannel, type AdChannel } from "./channels";
import { buildCreativeReport, type CreativeReport } from "./creatives";

/** Per-ad performance for the Creative tab. Only platforms that report per ad have rows. Aggregates only: no customer data. */
export async function loadCreatives(range: { from: string; to: string }, channels: readonly AdChannel[]): Promise<CreativeReport> {
  if (channels.length === 0) return buildCreativeReport([]);
  const rows = await prisma.adCreativeDaily.findMany({
    where: { provider: { in: [...channels] }, date: { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T00:00:00Z`) } },
    take: 50_000,
  });
  return buildCreativeReport(
    rows.flatMap((r) =>
      isAdChannel(r.provider)
        ? [{ channel: r.provider, campaignId: r.campaignId, campaignName: r.campaignName, adId: r.adId, adName: r.adName, format: r.format, date: r.date.toISOString().slice(0, 10), spendMinor: Number(r.spendMinor), currency: r.currency, impressions: r.impressions, clicks: r.clicks, leads: r.leads }]
        : [],
    ),
  );
}
