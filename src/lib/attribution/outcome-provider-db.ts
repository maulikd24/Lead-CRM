import { loadImpact } from "./impact-db";
import { createOutcomeProvider, type CampaignOutcomeProvider } from "./outcome-provider";

/**
 * The database-backed CampaignOutcomeProvider: the same loader the Campaign impact tab uses (aggregates only, `viewer` null), so the tab, the
 * director reports, Autopilot, creative and closed-loop all read ONE set of numbers. The access check lives in the provider (outcome-provider.ts),
 * before this loader runs. `now` is injectable for tests; production uses the shared instance.
 */
let singleton: CampaignOutcomeProvider | null = null;

const build = (now?: () => Date): CampaignOutcomeProvider =>
  createOutcomeProvider({
    now,
    load: async (period, opts) => {
      const data = await loadImpact(period, null, now?.(), { includeClients: opts?.includeClients });
      return { report: data.report, freshness: data.freshness, truncated: data.truncated, clients: data.clients };
    },
  });

export function getCampaignOutcomeProvider(opts: { now?: () => Date } = {}): CampaignOutcomeProvider {
  if (opts.now) return build(opts.now);
  singleton ??= build();
  return singleton;
}
