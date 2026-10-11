import { detectFatigue, type FatigueResult, type FatigueThresholds } from "@/lib/marketing/fatigue";
import type { AdSeries } from "@/lib/marketing/creatives";

import type { AdOutcomeRow } from "./outcomes";
import { findWinners, type Tags, type WinnerSettings, type WinnersResult } from "./winners";

/** Puts one ad's performance, outcomes, fatigue and tags together for the Insights tab. Pure. */

export type InsightAd = {
  key: string;
  channel: string;
  adId: string;
  adName: string;
  campaignName: string;
  format: string | null;
  spend: number | null;
  currency: string | null;
  impressions: number | null;
  clicks: number | null;
  platformLeads: number | null;
  leads: number | null;
  kyc: null;
  funded: number | null;
  revenue: number | null;
  costPerFunded: number | null;
  outcomes: "crm" | "platform_only";
  fatigue: FatigueResult | null;
  tags: Tags;
  tagStatus: "CONFIRMED" | "DRAFT";
  tagSources: Partial<Record<string, string>>;
};

export type InsightsView = { ads: InsightAd[]; winners: WinnersResult; fatiguedCount: number; /** False when no ad carries CRM outcomes (no ad id on leads). */ fundedKnown: boolean };

type StoredTags = Map<string, { tags: Tags; status: "CONFIRMED" | "DRAFT"; sources: Partial<Record<string, string>> }>;

export function buildInsights(input: { rows: AdOutcomeRow[]; series: AdSeries[]; tags: StoredTags; fatigue: FatigueThresholds; winners: WinnerSettings }): InsightsView {
  const seriesBy = new Map(input.series.filter((s) => s.adId).map((s) => [`${s.channel}:${s.adId}`, s]));
  const ads: InsightAd[] = input.rows
    .filter((r) => r.adId)
    .map((r) => {
      const key = `${r.channel}:${r.adId}`;
      const s = seriesBy.get(key);
      const t = input.tags.get(key);
      return {
        key, channel: r.channel, adId: r.adId as string, adName: r.adName ?? (r.adId as string), campaignName: r.campaignName, format: r.format,
        spend: r.spend, currency: r.currency, impressions: r.impressions, clicks: r.clicks, platformLeads: r.platformLeads, leads: r.leads, kyc: r.kyc, funded: r.funded, revenue: r.revenue,
        costPerFunded: r.costPerFunded,
        outcomes: r.outcomes,
        fatigue: s ? detectFatigue(s.points, input.fatigue) : null,
        tags: t?.tags ?? {}, tagStatus: t?.status ?? "CONFIRMED", tagSources: t?.sources ?? {},
      };
    })
    .sort((a, b) => (b.funded ?? -1) - (a.funded ?? -1) || (b.spend ?? 0) - (a.spend ?? 0));

  const fundedKnown = ads.some((a) => a.outcomes === "crm");
  const winners: WinnersResult = fundedKnown
    ? findWinners(ads.filter((a) => a.outcomes === "crm").map((a) => ({ key: a.key, name: a.adName, spend: a.spend ?? 0, funded: a.funded ?? 0, costPerFunded: a.costPerFunded, tags: a.tags, tagStatus: a.tagStatus })), input.winners)
    : { state: "not_enough_data", reason: "Ad-level funded customers need an ad id on each lead (the ad_id or utm_content field), and none was found. Until then ads show the platform's own numbers only.", winners: [], shared: [], usesDraftTags: false };
  return { ads, winners, fatiguedCount: ads.filter((a) => a.fatigue?.status === "fatigued").length, fundedKnown };
}
