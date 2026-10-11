import type { AuctionRow, AutopilotSnapshot } from "./types";

/** Google auction insights: impression share, overlap and position against named competitors. Pure. */

export type AuctionCampaign = {
  campaignId: string;
  campaignName: string;
  yourImpressionShare: number | null;
  competitors: AuctionRow[];
};
export type AuctionReport = { available: true; campaigns: AuctionCampaign[] } | { available: false; reason: string };

export function auctionInsights(s: AutopilotSnapshot): AuctionReport {
  const google = s.campaigns.filter((c) => c.platform === "google");
  if (google.length === 0) return { available: false, reason: "Auction insights exist for Google Ads only, and no Google campaign is connected." };
  const rows = s.auction ?? [];
  if (rows.length === 0) return { available: false, reason: "Google has not reported auction insights for these campaigns yet. Not available." };
  const campaigns: AuctionCampaign[] = google.flatMap((c) => {
    const mine = rows.filter((r) => r.campaignId === c.id);
    if (mine.length === 0) return [];
    const you = mine.find((r) => r.competitor === "You");
    return [{ campaignId: c.id, campaignName: c.name, yourImpressionShare: you ? you.impressionShare : null, competitors: mine.filter((r) => r.competitor !== "You").sort((a, b) => b.overlapRate - a.overlapRate) }];
  });
  if (campaigns.length === 0) return { available: false, reason: "No auction data for the connected Google campaigns. Not available." };
  return { available: true, campaigns };
}
