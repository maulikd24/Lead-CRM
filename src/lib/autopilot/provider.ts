import { autopilotApplyEnabled } from "./flags";
import { createUnconfiguredActionProvider, guarded, type GuardedProvider } from "./actions";

/**
 * The action provider the app uses. Until an Admin connects an ad account (documented path: the Meta ads connection),
 * this is the unconfigured adapter, which refuses everything. Tests replace this module.
 */
export function getActionProvider(env: Record<string, string | undefined> = process.env): GuardedProvider {
  return guarded(createUnconfiguredActionProvider(), { applyEnabled: autopilotApplyEnabled(env) });
}
