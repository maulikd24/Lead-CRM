import { buildInsights, type InsightsView } from "./insights";
import type { FatigueThresholds } from "@/lib/marketing/fatigue";
import { loadAdOutcomes, type Viewer } from "./outcomes-db";
import { getFatigueThresholds, getWinnerSettings } from "./settings";
import { loadTags } from "./tags-db";
import type { WinnerSettings } from "./winners";

export type InsightsData = { view: InsightsView; asOf: string | null; notes: string[]; currency: string | null; thresholds: { fatigue: FatigueThresholds; winners: WinnerSettings } };

/** Ad-level performance for the Insights tab. Outcomes come from the CampaignOutcomeProvider; fatigue looks at the 28 days up to the end of the range. */
export async function loadInsights(viewer: Viewer, range: { from: string; to: string }): Promise<InsightsData> {
  const [outcomes, fatigue, winners] = await Promise.all([loadAdOutcomes(viewer, range), getFatigueThresholds(), getWinnerSettings()]);
  const tags = await loadTags(outcomes.rows.map((r) => `${r.channel}:${r.adId}`));
  return { view: buildInsights({ rows: outcomes.rows, series: outcomes.series, tags, fatigue, winners }), asOf: outcomes.asOf, notes: outcomes.notes, currency: outcomes.currency, thresholds: { fatigue, winners } };
}
