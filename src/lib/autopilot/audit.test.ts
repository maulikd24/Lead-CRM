import { describe, expect, it } from "vitest";

import { runAudit, shouldRunDaily, type AuditDeps, type AuditEvent } from "./audit";
import { demoSnapshot } from "./fixture.testkit";
import type { Recommendation } from "./recommendations";
import type { Rule } from "./rules";

const NOW = new Date("2026-10-11T06:00:00.000Z");

/** In-memory store with the same semantics as the database one: a known proposal keeps its status; only new ones are "created". */
function harness(over: Partial<AuditDeps> = {}, rules: Rule[] = []) {
  const known = new Map<string, Recommendation>();
  const runs: { id: string; correlationId: string; status: string; patch?: Record<string, unknown> }[] = [];
  const events: AuditEvent[] = [];
  const windows: number[][] = [];
  let expired = 0;
  const deps: AuditDeps = {
    now: () => NOW,
    listRules: async () => rules,
    recentDenials: async () => [],
    loadSnapshot: async (w) => { windows.push(w); return demoSnapshot({ withOptional: true }); },
    createRun: async (trigger) => { const r = { id: `run-${runs.length + 1}`, correlationId: `7f9c24e8-3b0a-5c5e-9d77-3b2f5f6d0a${String(runs.length + 10)}`, status: "RUNNING" }; runs.push(r); void trigger; return r; },
    finishRun: async (id, patch) => { const r = runs.find((x) => x.id === id)!; r.status = patch.status as string; r.patch = patch as never; },
    syncRecommendations: async (fresh, run) => {
      const created: string[] = [];
      const recs = fresh.map((r) => { const e = known.get(r.id); if (e) return { ...r, status: e.status }; created.push(r.id); const n = { ...r, status: "PENDING" as const, correlationId: run.correlationId }; known.set(r.id, n); return n; });
      return { recs, created };
    },
    expireStale: async () => expired,
    emit: async (e) => { events.push(e); },
    ...over,
  };
  return { deps, known, runs, events, windows, setExpired: (n: number) => { expired = n; } };
}

describe("the daily audit", () => {
  it("one run: a correlation id, the proposals, the counts, and agent run events around it", async () => {
    const h = harness();
    const res = await runAudit(h.deps, { trigger: "job" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].status).toBe("SUCCEEDED");
    expect(res.proposals).toBeGreaterThan(0);
    expect(res.newProposals).toBe(res.proposals);
    expect(res.healthScore).not.toBeNull();
    const kinds = h.events.map((e) => e.type);
    expect(kinds[0]).toBe("agent.run.started");
    expect(kinds[kinds.length - 1]).toBe("agent.run.completed");
    expect(kinds.filter((k) => k === "recommended")).toHaveLength(res.newProposals);
  });

  it("every proposal and every event of the run carries the run's correlation id (so a decision and an applied action can be traced back to it)", async () => {
    const h = harness();
    await runAudit(h.deps, { trigger: "job" });
    const cid = h.runs[0].correlationId;
    expect(h.events.every((e) => e.correlationId === cid)).toBe(true);
    expect([...h.known.values()].every((r) => r.correlationId === cid)).toBe(true);
  });

  it("a second run proposes nothing new and emits no 'recommended' again (the same issue is the same proposal)", async () => {
    const h = harness();
    await runAudit(h.deps, { trigger: "job" });
    h.events.length = 0;
    const res = await runAudit(h.deps, { trigger: "job" });
    expect(res.ok && res.newProposals).toBe(0);
    expect(h.events.map((e) => e.type)).toEqual(["agent.run.started", "agent.run.completed"]);
    expect(h.runs).toHaveLength(2);
  });

  it("a decided proposal is not open and not counted again", async () => {
    const h = harness();
    await runAudit(h.deps, { trigger: "job" });
    const [first] = [...h.known.values()];
    h.known.set(first.id, { ...first, status: "DENIED" });
    const res = await runAudit(h.deps, { trigger: "job" });
    expect(res.ok && res.open).toBe([...h.known.values()].filter((r) => r.status === "PENDING").length);
  });

  it("repeated quiet denials suppress a proposal from the open list (the learning loop)", async () => {
    const h = harness();
    await runAudit(h.deps, { trigger: "job" });
    const target = [...h.known.values()][0];
    const key = [...target.action.targetIds].sort().join(",") || "account";
    const denial = (n: number) => ({ recId: target.id, ruleKey: target.ruleKey, targetKey: key, decision: "DENIED" as const, reasonCode: "not_relevant" as const, note: null, actorId: "u1", at: new Date(NOW.getTime() - n * 86_400_000).toISOString() });
    const h2 = harness({ recentDenials: async () => [denial(1), denial(2)] });
    h2.known.set(target.id, { ...target, status: "PENDING" });
    const res = await runAudit(h2.deps, { trigger: "job" });
    const plain = await runAudit(harness().deps, { trigger: "job" });
    expect(res.ok && plain.ok && res.open).toBeLessThan(plain.ok ? plain.open : 0);
  });

  it("looks back over the window of every enabled rule, and a rule's proposals are part of the run", async () => {
    const rule: Rule = { id: "r1", name: "Pause expensive", enabled: true, metric: "cost_per_funded", op: ">", threshold: 1, days: 14, campaignIds: null, accountIds: null, action: "pause_campaign" };
    const off: Rule = { ...rule, id: "r2", days: 60, enabled: false };
    const h = harness({}, [rule, off]);
    const res = await runAudit(h.deps, { trigger: "job" });
    expect(h.windows[0]).toEqual([14]);
    expect(res.ok).toBe(true);
    expect([...h.known.keys()].some((id) => id.startsWith("RULE_r1:"))).toBe(true);
  });

  it("expires undecided proposals that were not found again", async () => {
    const h = harness();
    h.setExpired(3);
    const res = await runAudit(h.deps, { trigger: "job" });
    expect(res.ok && res.expired).toBe(3);
  });

  it("a failure marks the run FAILED, emits agent.run.failed with an error CLASS (never the message), and reports it", async () => {
    const h = harness({ loadSnapshot: async () => { throw Object.assign(new Error("connection to postgres://secret@host failed for 9876543210"), { name: "PrismaClientKnownRequestError" }); } });
    const res = await runAudit(h.deps, { trigger: "job" });
    expect(res.ok).toBe(false);
    expect(h.runs[0].status).toBe("FAILED");
    const failed = h.events.find((e) => e.type === "agent.run.failed")!;
    expect(failed).toBeDefined();
    expect(JSON.stringify(failed)).not.toMatch(/secret|9876543210|postgres/);
    expect(JSON.stringify(h.runs[0].patch)).not.toMatch(/secret|9876543210|postgres/);
  });

  it("a failure to store an event never fails the audit", async () => {
    const h = harness({ emit: async () => { throw new Error("events down"); } });
    expect((await runAudit(h.deps, { trigger: "job" })).ok).toBe(true);
  });

  it("the audit proposes and records only: it never touches an ad account (it has no action provider)", () => {
    const keys = Object.keys(harness().deps);
    expect(keys.some((k) => /apply|provider|launch|activate/i.test(k))).toBe(false);
  });
});

describe("schedule: once a day", () => {
  const at = (h: string) => new Date(`2026-10-11T${h}:00.000Z`);
  it("runs when no job run has succeeded in the last 20 hours", () => {
    expect(shouldRunDaily(null, at("06:00"))).toBe(true);
    expect(shouldRunDaily(new Date("2026-10-10T08:00:00.000Z"), at("06:00"))).toBe(true);
    expect(shouldRunDaily(new Date("2026-10-11T01:00:00.000Z"), at("06:00"))).toBe(false);
    expect(shouldRunDaily(new Date("2026-10-10T10:01:00.000Z"), at("06:00"))).toBe(false);
  });
});
