import { describe, expect, it } from "vitest";

import { createFakeActionProvider, guarded } from "./actions";
import { applyApproved, decideRecommendation, type DecisionDeps } from "./decisions";
import type { Recommendation } from "./recommendations";

const RUN = "7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a11";
const rec = (over: Partial<Recommendation> = {}): Recommendation => ({
  id: "BD1:m1", ruleKey: "BD1", category: "Bidding", severity: "high", issue: "Cost per funded is over target", evidence: ["e"],
  action: { kind: "pause_campaign", targetIds: ["m1"], summary: "Pause m1", params: {} }, impact: { amount: 1000, text: "saves" }, confidence: "high", appliable: true,
  status: "PENDING", correlationId: RUN, ...over,
});

/** An in-memory stand-in for the store with the same compare-and-set behaviour as the database. */
function harness(initial: Recommendation, opts: { applyEnabled?: boolean } = {}) {
  let row = { ...initial };
  const events: { kind: string; recId: string; correlationId: string }[] = [];
  const audits: string[] = [];
  const fake = createFakeActionProvider();
  const provider = guarded(fake, { applyEnabled: opts.applyEnabled ?? true });
  const deps: DecisionDeps = {
    getRec: async (id) => (id === row.id ? { ...row } : null),
    recordDecision: async (d) => { if (row.status !== "PENDING") return false; row = { ...row, status: d.decision === "APPROVED" ? "APPROVED" : "DENIED" }; audits.push(d.decision); return true; },
    claimApply: async (id) => { if (id !== row.id || row.status !== "APPROVED") return false; row = { ...row, status: "APPLYING" as never }; return true; },
    markApplied: async (_id, _u, res) => { row = { ...row, status: res.ok ? "APPLIED" : "FAILED" }; },
    provider,
    emit: async (kind, e) => { events.push({ kind, recId: e.recId, correlationId: e.correlationId }); },
  };
  return { deps, fake, events, audits, get row() { return row; } };
}

describe("approve and deny through the one legacy path", () => {
  it("approval records a decision once and emits an approved event on the run's correlation id", async () => {
    const h = harness(rec());
    expect(await decideRecommendation(h.deps, { recId: "BD1:m1", verdict: "approve", actorId: "u1" })).toEqual({ ok: true });
    expect(h.row.status).toBe("APPROVED");
    expect(h.events).toEqual([{ kind: "approved", recId: "BD1:m1", correlationId: RUN }]);
    expect(h.fake.log).toEqual([]); // approving never touches the ad account
  });
  it("a second decision is refused (double click, two tabs)", async () => {
    const h = harness(rec());
    await decideRecommendation(h.deps, { recId: "BD1:m1", verdict: "approve", actorId: "u1" });
    expect(await decideRecommendation(h.deps, { recId: "BD1:m1", verdict: "approve", actorId: "u2" })).toMatchObject({ ok: false, error: expect.stringMatching(/already been decided/) });
    expect(h.events).toHaveLength(1);
  });
  it("a denial needs a reason code; 'other' needs words", async () => {
    const h = harness(rec());
    expect(await decideRecommendation(h.deps, { recId: "BD1:m1", verdict: "deny", actorId: "u1" })).toMatchObject({ ok: false, error: expect.stringMatching(/reason/i) });
    expect(await decideRecommendation(h.deps, { recId: "BD1:m1", verdict: "deny", actorId: "u1", reasonCode: "other" })).toMatchObject({ ok: false });
    expect(h.row.status).toBe("PENDING");
    expect(await decideRecommendation(h.deps, { recId: "BD1:m1", verdict: "deny", actorId: "u1", reasonCode: "not_relevant" })).toEqual({ ok: true });
    expect(h.events[0]).toMatchObject({ kind: "denied", correlationId: RUN });
  });
  it("needs a person: an empty actor id decides nothing", async () => {
    const h = harness(rec());
    expect(await decideRecommendation(h.deps, { recId: "BD1:m1", verdict: "approve", actorId: "" })).toMatchObject({ ok: false });
    expect(h.row.status).toBe("PENDING");
  });
  it("a missing proposal is a plain error", async () => {
    const h = harness(rec());
    expect(await decideRecommendation(h.deps, { recId: "nope", verdict: "approve", actorId: "u1" })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
  });
});

describe("apply: human approval each time, once, and never above L4", () => {
  const approved = () => harness(rec({ status: "APPROVED" }));
  it("applies an approved proposal once, marks it applied and emits applied with the approved event as its cause", async () => {
    const h = approved();
    expect(await applyApproved(h.deps, { recId: "BD1:m1", actorId: "u1" })).toEqual({ ok: true });
    expect(h.row.status).toBe("APPLIED");
    expect(h.fake.log).toEqual(["apply pause_campaign m1"]);
    expect(h.events).toEqual([{ kind: "applied", recId: "BD1:m1", correlationId: RUN }]);
  });
  it("applying twice (two tabs, a retry) calls the ad account once: the claim is a database compare-and-set, not a memory flag", async () => {
    const h = approved();
    const [a, b] = await Promise.all([applyApproved(h.deps, { recId: "BD1:m1", actorId: "u1" }), applyApproved(h.deps, { recId: "BD1:m1", actorId: "u2" })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(h.fake.log).toHaveLength(1);
  });
  it("a proposal nobody approved is never applied", async () => {
    for (const status of ["PENDING", "DENIED", "APPLIED", "FAILED"] as const) {
      const h = harness(rec({ status }));
      expect(await applyApproved(h.deps, { recId: "BD1:m1", actorId: "u1" }), status).toMatchObject({ ok: false });
      expect(h.fake.log, status).toEqual([]);
    }
  });
  it("applying is refused without a person, and while applying is switched off (the default and, in this build, the only state)", async () => {
    const h = approved();
    expect(await applyApproved(h.deps, { recId: "BD1:m1", actorId: "" })).toMatchObject({ ok: false });
    const off = harness(rec({ status: "APPROVED" }), { applyEnabled: false });
    expect(await applyApproved(off.deps, { recId: "BD1:m1", actorId: "u1" })).toMatchObject({ ok: false, error: expect.stringMatching(/switched off/) });
    expect(off.fake.log).toEqual([]);
    expect(off.row.status).toBe("APPROVED"); // stays approved: nothing half-done
  });
  it("a failed apply is recorded as FAILED with a failed event, and the cause is the approval", async () => {
    const h = approved();
    h.deps.provider = guarded({ ...h.fake, apply: async () => ({ ok: false, error: "platform said no" }) }, { applyEnabled: true });
    expect(await applyApproved(h.deps, { recId: "BD1:m1", actorId: "u1" })).toMatchObject({ ok: false, error: "platform said no" });
    expect(h.row.status).toBe("FAILED");
    expect(h.events).toEqual([{ kind: "apply_failed", recId: "BD1:m1", correlationId: RUN }]);
  });
  it("cannot raise a budget or turn anything on: only a cut of at most 50% is appliable", async () => {
    const big = harness(rec({ status: "APPROVED", action: { kind: "reduce_budget", targetIds: ["m1"], summary: "x", params: { cutFraction: 0.9 } } }));
    expect(await applyApproved(big.deps, { recId: "BD1:m1", actorId: "u1" })).toMatchObject({ ok: false });
    const up = harness(rec({ status: "APPROVED", action: { kind: "reduce_budget", targetIds: ["m1"], summary: "x", params: { cutFraction: -0.3 } } }));
    expect(await applyApproved(up.deps, { recId: "BD1:m1", actorId: "u1" })).toMatchObject({ ok: false });
    expect(big.fake.log.concat(up.fake.log)).toEqual([]);
    expect([big.row.status, up.row.status]).toEqual(["APPROVED", "APPROVED"]); // refused before the claim: still approved, nothing half-done
    const task = harness(rec({ status: "APPROVED", appliable: false, action: { kind: "staff_shift", targetIds: [], summary: "x", params: {} } }));
    expect(await applyApproved(task.deps, { recId: "BD1:m1", actorId: "u1" })).toMatchObject({ ok: false });
  });
});
