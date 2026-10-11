import { plannerEnabled } from "./flag";

/**
 * The scheduled destination health check: re-checks every registered destination (URL pattern, and one HEAD request for a public https web page)
 * and stores the verdict, so a destination that stopped answering shows on the board before a campaign lands on it. Runs through the ONE job
 * recorder (runJob, key `planner-destination-health`). A no-op unless NEXT_PUBLIC_PLANNER=1. It contacts no customer and changes no plan: it
 * only updates the destination's own health fields.
 */
export type HealthJobDeps = { enabled: () => boolean; run: () => Promise<{ checked: number; unhealthy: number }> };

const defaults = (): HealthJobDeps => ({
  enabled: () => plannerEnabled(),
  run: async () => (await import("./db")).runDestinationHealthChecks(),
});

export async function runPlannerHealthJob(deps: HealthJobDeps = defaults()): Promise<{ checked: number; unhealthy: number } | { skipped: "flag off" }> {
  if (!deps.enabled()) return { skipped: "flag off" };
  return deps.run();
}
