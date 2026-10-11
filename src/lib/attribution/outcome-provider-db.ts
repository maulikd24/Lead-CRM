import { loadImpact } from "./impact-db";
import { createOutcomeProvider, type CampaignOutcomeProvider } from "./outcome-provider";

/**
 * The database-backed CampaignOutcomeProvider: the same loader the Campaign impact tab uses (aggregates only, `viewer` null), so the tab, the
 * director reports, Autopilot, creative and closed-loop all read ONE set of numbers. The access check lives in the provider (outcome-provider.ts),
 * before this loader runs.
 */
let singleton: CampaignOutcomeProvider | null = null;

export function getCampaignOutcomeProvider(): CampaignOutcomeProvider {
  singleton ??= createOutcomeProvider({
    load: async (period) => {
      const data = await loadImpact(period, null);
      return { report: data.report, freshness: data.freshness, truncated: data.truncated };
    },
  });
  return singleton;
}
