import { addDays } from "@/lib/marketing/dates";

import { buildInsights, type InsightsView } from "./insights";
import type { FatigueThresholds } from "./fatigue";
import { getOutcomeProvider } from "./outcomes-db";
import { getFatigueThresholds, getWinnerSettings } from "./settings";
import { loadTags } from "./tags-db";
import type { WinnerSettings } from "./winners";

export type InsightsData = { view: InsightsView; asOf: string | null; notes: string[]; currency: string | null; thresholds: { fatigue: FatigueThresholds; winners: WinnerSettings } };

/** Ad-level performance for the Insights tab. Fatigue always looks at the 28 days up to the end of the range, so a 7-day view still has enough history. */
export async function loadInsights(range: { from: string; to: string }): Promise<InsightsData> {
  const provider = getOutcomeProvider();
  const [outcomes, series, fatigue, winners] = await Promise.all([
    provider.getOutcomes({ ...range, level: "ad" }),
    provider.getDailySeries({ from: addDays(range.to, -27), to: range.to, level: "ad" }),
    getFatigueThresholds(),
    getWinnerSettings(),
  ]);
  const tags = await loadTags(outcomes.rows.filter((r) => r.adId).map((r) => `${r.channel}:${r.adId}`));
  return { view: buildInsights({ rows: outcomes.rows, series, tags, fatigue, winners }), asOf: outcomes.asOf, notes: outcomes.notes, currency: outcomes.currency, thresholds: { fatigue, winners } };
}
