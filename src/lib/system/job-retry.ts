import { MAX_RETRY_ATTEMPTS } from "./failures";
import { jobSpec } from "./job-registry";
import { recordRun, type RunStore } from "./job-run";
export { JOB_RUNNER_KEYS } from "./job-runner-keys";

/**
 * The Admin "Retry" for a failed scheduled job: re-runs it ONCE, only if the registry marks it idempotent, only while it is still failing,
 * capped at MAX_RETRY_ATTEMPTS, through the same lease as the tick (so it can never overlap one), recorded as a RETRY run and audited.
 * Pure: the lease, the runners, the store and the audit are injected (job-retry-db.ts wires the real ones).
 */
export type RetryDeps = {
  findRun(id: string): Promise<{ id: string; job: string; status: string; attempt: number } | null>;
  latestStatus(job: string): Promise<string | null>;
  claimLease(): Promise<boolean>;
  releaseLease(): Promise<void>;
  runners: Record<string, () => Promise<unknown>>;
  store: RunStore;
  now?: () => Date;
  newId?: () => string;
  audit(entry: { entity: string; entityId: string; action: string; reason: string | null; userId: string }): Promise<void>;
};

export type RetryResult =
  | { outcome: "ran"; ok: boolean }
  | { outcome: "refused"; reason: "not-found" | "not-failed" | "not-failing" | "not-safe" | "no-runner" | "dead" | "tick-running" };

const BAD = new Set(["FAILED", "TIMEOUT"]);
const refuse = (reason: Extract<RetryResult, { outcome: "refused" }>["reason"]): RetryResult => ({ outcome: "refused", reason });

export async function retryJob(deps: RetryDeps, input: { runId: string; userId: string }): Promise<RetryResult> {
  const run = await deps.findRun(input.runId);
  if (!run) return refuse("not-found");
  if (!BAD.has(run.status)) return refuse("not-failed");
  const spec = jobSpec(run.job);
  if (!spec || spec.kind !== "CRON" || !spec.safeToRun) return refuse("not-safe");
  const runner = deps.runners[run.job];
  if (!runner) return refuse("no-runner");
  if (run.attempt >= MAX_RETRY_ATTEMPTS) return refuse("dead");
  const latest = await deps.latestStatus(run.job);
  if (!latest || !BAD.has(latest)) return refuse("not-failing");
  if (!(await deps.claimLease())) return refuse("tick-running");

  try {
    let ok = true;
    const result = await recordRun(spec, { store: deps.store, now: deps.now, newId: deps.newId, kind: "RETRY", attempt: run.attempt + 1, retryOfId: run.id, trigger: `admin:${input.userId}` }, runner);
    if (result && typeof result === "object" && "error" in result) ok = false;
    await deps.audit({ entity: "ControlPlane", entityId: run.job, action: "control_plane.retry", reason: `attempt ${run.attempt + 1} of ${MAX_RETRY_ATTEMPTS}, ${ok ? "succeeded" : "failed again"}`, userId: input.userId });
    return { outcome: "ran", ok };
  } finally {
    await deps.releaseLease();
  }
}
