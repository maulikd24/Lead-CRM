import { describe, expect, it, vi } from "vitest";

import type { RunRow, RunStore } from "./job-run";
import { JOB_RUNNER_KEYS, retryJob, type RetryDeps } from "./job-retry";
import { CRON_JOBS } from "./job-registry";

function setup(over: Partial<{ run: { id: string; job: string; status: string; attempt: number } | null; latestStatus: string; leaseFree: boolean; runner: () => Promise<unknown> }> = {}) {
  const rows: RunRow[] = [];
  const store: RunStore = { insert: async () => {}, update: async () => {}, createMany: async (b) => { rows.push(...b); } };
  const audits: { entity: string; entityId: string; action: string; reason: string | null }[] = [];
  const events: string[] = [];
  const runner = vi.fn(over.runner ?? (async () => ({ retried: 2 })));
  const deps: RetryDeps = {
    findRun: async () => (over.run === undefined ? { id: "r1", job: "retryFailedLeads", status: "FAILED", attempt: 1 } : over.run),
    latestStatus: async () => over.latestStatus ?? "FAILED",
    claimLease: async () => { events.push("claim"); return over.leaseFree ?? true; },
    releaseLease: async () => { events.push("release"); },
    runners: { retryFailedLeads: runner, "merge-suggestions": async () => ({}) },
    store, now: () => new Date(1000), newId: () => "new1",
    audit: async (a) => { audits.push(a); events.push("audit"); },
  };
  return { deps, rows, audits, events, runner };
}

describe("retryJob", () => {
  it("re-runs an idempotent failed job exactly once, records a RETRY row with attempt + 1, audits it, and returns the lease", async () => {
    const { deps, rows, audits, events, runner } = setup();
    const out = await retryJob(deps, { runId: "r1", userId: "u1" });
    expect(out).toEqual({ outcome: "ran", ok: true });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ job: "retryFailedLeads", kind: "RETRY", attempt: 2, retryOfId: "r1", trigger: "admin:u1", status: "OK" });
    expect(audits[0]).toMatchObject({ entity: "ControlPlane", entityId: "retryFailedLeads", action: "control_plane.retry" });
    expect(events).toEqual(["claim", "audit", "release"]);
  });
  it("records the retry's own failure, still audits and still releases the lease", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, rows, events } = setup({ runner: async () => { throw new TypeError("nope"); } });
    const out = await retryJob(deps, { runId: "r1", userId: "u1" });
    spy.mockRestore();
    expect(out).toEqual({ outcome: "ran", ok: false });
    expect(rows[0]).toMatchObject({ status: "FAILED", errorClass: "TypeError", attempt: 2 });
    expect(events.at(-1)).toBe("release");
  });
  it.each([
    ["a run that does not exist", { run: null }, "not-found"],
    ["a run that did not fail", { run: { id: "r1", job: "retryFailedLeads", status: "OK", attempt: 1 } }, "not-failed"],
    ["a job that is no longer failing", { latestStatus: "OK" }, "not-failing"],
    ["a job that sends messages", { run: { id: "r1", job: "agent-nudger", status: "FAILED", attempt: 1 } }, "not-safe"],
    ["a webhook", { run: { id: "r1", job: "webhook:leads-web", status: "FAILED", attempt: 1 } }, "not-safe"],
    ["an idempotent job with no runner wired", { run: { id: "r1", job: "pruneSecurityTables", status: "FAILED", attempt: 1 } }, "no-runner"],
    ["a retry chain at the cap", { run: { id: "r1", job: "retryFailedLeads", status: "FAILED", attempt: 5 } }, "dead"],
  ])("refuses %s", async (_label, over, reason) => {
    const { deps, rows, runner, audits } = setup(over as never);
    expect(await retryJob(deps, { runId: "r1", userId: "u1" })).toEqual({ outcome: "refused", reason });
    expect(runner).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
    expect(audits).toEqual([]);
  });
  it("refuses while a tick holds the lease, and does not release a lease it never got", async () => {
    const { deps, events, runner } = setup({ leaseFree: false });
    expect(await retryJob(deps, { runId: "r1", userId: "u1" })).toEqual({ outcome: "refused", reason: "tick-running" });
    expect(runner).not.toHaveBeenCalled();
    expect(events).toEqual(["claim"]);
  });
});

describe("job runners", () => {
  it("exist for exactly the jobs the registry marks safe to run", () => {
    expect([...JOB_RUNNER_KEYS].sort()).toEqual(CRON_JOBS.filter((j) => j.safeToRun).map((j) => j.key).sort());
  });
});
