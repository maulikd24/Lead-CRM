import { prisma } from "@/lib/db/prisma";

import { detectCampaignAnomalies, type Anomaly, type DailyRow } from "./campaign-anomalies";

/**
 * Campaign anomalies for the Needs attention feed. Lives in the marketing module on purpose: it is the only place outside the
 * marketing code that reads ad-spend rows, and the segregation test keeps it that way. Aggregate platform numbers only, never a person.
 */
export async function loadCampaignAnomalies(now: Date): Promise<Anomaly[]> {
  const rows = await prisma.adCampaignDaily.findMany({
    where: { date: { gte: new Date(now.getTime() - 10 * 86_400_000) } },
    select: { campaignId: true, campaignName: true, date: true, spendMinor: true, leads: true, impressions: true, clicks: true },
    take: 2000,
  });
  const daily: DailyRow[] = rows.map((r) => ({ ...r, spendMinor: Number(r.spendMinor) }));
  return detectCampaignAnomalies(daily, now);
}
