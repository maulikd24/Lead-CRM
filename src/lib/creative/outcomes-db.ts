import { getCampaignOutcomeProvider, type CampaignOutcomeProvider, type OutcomeCaller, type OutcomeReport } from "@/lib/attribution";
import { loadAdDeliveryFor } from "@/lib/marketing/creatives-db";
import { addDays } from "@/lib/marketing/dates";
import type { AdSeries } from "@/lib/marketing/creatives";

import { joinAdOutcomes, type AdOutcomes } from "./outcomes";

/**
 * Where creative reads outcomes: the canonical CampaignOutcomeProvider (as the signed-in ADMIN or MARKETING person, so the provider's own access
 * rule applies), and the platform's delivery per ad from the marketing module. No spend table is read here and no outcome is computed here.
 */
export type Viewer = { id: string; role: string };
const callerOf = (viewer: Viewer): OutcomeCaller => ({ kind: "user", id: viewer.id, role: viewer.role });
const CHANNELS = ["meta", "google"] as const;

/** Ad rows for the range, with day-by-day delivery for the 28 days up to its end (fatigue always looks at 28 days, so a 7-day view still has history). */
export async function loadAdOutcomes(viewer: Viewer, range: { from: string; to: string }, provider: CampaignOutcomeProvider = getCampaignOutcomeProvider()): Promise<AdOutcomes & { series: AdSeries[] }> {
  const [report, delivery, history] = await Promise.all([
    provider.outcomes({ grain: "ad", period: range }, callerOf(viewer)),
    loadAdDeliveryFor(viewer.role, range, CHANNELS),
    loadAdDeliveryFor(viewer.role, { from: addDays(range.to, -27), to: range.to }, CHANNELS),
  ]);
  return { ...joinAdOutcomes(report, delivery.report), series: history.series };
}

/** Campaign-grain report for a window (experiments: the account's own lead-to-funded rate, and the campaigns an experiment can link to). */
export function loadCampaignReport(viewer: Viewer, range: { from: string; to: string }, provider: CampaignOutcomeProvider = getCampaignOutcomeProvider()): Promise<OutcomeReport> {
  return provider.outcomes({ grain: "campaign", period: range }, callerOf(viewer));
}
