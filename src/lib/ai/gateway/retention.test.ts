import { describe, expect, it } from "vitest";

import { istDay, pruneAgentRuns, rollupGroups, type ExpiredRun, type RetentionStore } from "./retention";

const run = (over: Partial<ExpiredRun> = {}): ExpiredRun => ({ id: "r", createdAt: new Date("2026-07-01T10:00:00Z"), agentKey: "wa_nudger", purposeId: "nudger.draft", status: "OK", inputTokens: 100, outputTokens: 50, costUsdEstimate: 0.01, latencyMs: 400, ...over });

describe("rollupGroups", () => {
  it("groups by Indian day, agent, purpose and status and sums the counters", () => {
    const g = rollupGroups([run({ id: "1" }), run({ id: "2", costUsdEstimate: 0.02, latencyMs: 600 }), run({ id: "3", status: "BLOCKED", inputTokens: 0, outputTokens: 0, costUsdEstimate: 0 }), run({ id: "4", agentKey: null })]);
    expect(g).toHaveLength(3);
    const ok = g.find((x) => x.agentKey === "wa_nudger" && x.status === "OK")!;
    expect(ok).toMatchObject({ runs: 2, inputTokens: 200, outputTokens: 100, latencyMsTotal: 1000 });
    expect(ok.costUsdEstimate).toBeCloseTo(0.03, 6);
    expect(g.find((x) => x.agentKey === "")).toBeDefined(); // a purpose with no agent rolls up under ""
  });
  it("a run just after midnight in India belongs to the next Indian day", () => {
    expect(istDay(new Date("2026-07-01T18:31:00Z")).toISOString().slice(0, 10)).toBe("2026-07-02");
    expect(istDay(new Date("2026-07-01T18:29:00Z")).toISOString().slice(0, 10)).toBe("2026-07-01");
  });
});

describe("pruneAgentRuns", () => {
  function store(rows: ExpiredRun[]) {
    const left = [...rows];
    const rolled: unknown[] = [];
    const s: RetentionStore = {
      expired: async (_now, take) => left.slice(0, take),
      foldAndDelete: async (groups, ids) => { rolled.push(...groups); for (const id of ids) left.splice(left.findIndex((r) => r.id === id), 1); },
    };
    return { s, left, rolled };
  }
  it("folds expired rows into daily aggregates, deletes them, and reports the counts", async () => {
    const { s, left, rolled } = store([run({ id: "1" }), run({ id: "2" })]);
    const r = await pruneAgentRuns(s, new Date("2026-10-12T00:00:00Z"));
    expect(r).toEqual({ deleted: 2, groups: 1 });
    expect(left).toHaveLength(0);
    expect(rolled).toHaveLength(1);
  });
  it("is a no-op when nothing has expired", async () => {
    const { s } = store([]);
    expect(await pruneAgentRuns(s, new Date())).toEqual({ deleted: 0, groups: 0 });
  });
  it("works in bounded batches so one tick never runs long", async () => {
    const { s, left } = store(Array.from({ length: 2500 }, (_, i) => run({ id: String(i) })));
    const r = await pruneAgentRuns(s, new Date(), { batch: 1000, maxBatches: 2 });
    expect(r.deleted).toBe(2000);
    expect(left).toHaveLength(500);
  });
});
