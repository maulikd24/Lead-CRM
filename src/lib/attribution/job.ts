import { attributionEnabled } from "./flag";
import { sweepLeadPushes, type SweepResult } from "./lead-push";

/** The scheduled speed-to-lead sweep: marks contacted leads, escalates breaches to the manager. A no-op unless NEXT_PUBLIC_ATTRIBUTION=1. Never contacts a customer. */
export async function runLeadPushSweep(): Promise<SweepResult | { skipped: "flag off" }> {
  if (!attributionEnabled()) return { skipped: "flag off" };
  const { sweepDeps } = await import("./db");
  return sweepLeadPushes(sweepDeps());
}
