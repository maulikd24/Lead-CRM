import { describe, expect, it } from "vitest";
import { runNudgerBatch, PROVIDER_FAILURE_STOP, DEFAULT_BUDGET_MS, type BatchDeps } from "./nudger-batch";
import { PROVIDER_ERROR_REASON, type DraftResult } from "./nudger";

const drafted: DraftResult = { status: "drafted", proposalId: "p" };
const blocked: DraftResult = { status: "blocked", reason: "x", proposalId: "p" };
const skipped = (reason = "cooling down"): DraftResult => ({ status: "skipped", reason });
const providerDown = skipped(PROVIDER_ERROR_REASON);

function setup(ids: string[], results: Record<string, DraftResult | Error>, over: Partial<BatchDeps> = {}) {
  const log = { loaded: 0, loadLimit: -1, drafted: [] as string[], events: [] as string[] };
  const deps: BatchDeps = {
    isEnabled: async () => true,
    loadCandidates: async (limit) => { log.loaded++; log.loadLimit = limit; return ids; },
    markConsidered: async (id) => { log.events.push(`mark:${id}`); },
    now: () => new Date("2026-10-09T10:00:00Z"),
    draft: async (id) => { log.events.push(`draft:${id}`); log.drafted.push(id); const r = results[id] ?? drafted; if (r instanceof Error) throw r; return r; },
    ...over,
  };
  return { deps, log };
}

describe("runNudgerBatch", () => {
  it("returns zeros and never loads candidates when disabled", async () => {
    const { deps, log } = setup(["a"], {}, { isEnabled: async () => false });
    expect(await runNudgerBatch(10, deps)).toEqual({ drafted: 0, blocked: 0, skipped: 0, failed: 0 });
    expect(log.loaded).toBe(0);
    expect(log.drafted).toEqual([]);
  });

  it("counts drafted, blocked, skipped and failed", async () => {
    const { deps } = setup(["a", "b", "c", "d"], { a: drafted, b: blocked, c: skipped(), d: new Error("db") });
    expect(await runNudgerBatch(10, deps)).toEqual({ drafted: 1, blocked: 1, skipped: 1, failed: 1 });
  });

  it("isolates failures: a throw on one customer does not stop the rest", async () => {
    const { deps, log } = setup(["a", "b", "c"], { a: new Error("boom") });
    const res = await runNudgerBatch(10, deps);
    expect(log.drafted).toEqual(["a", "b", "c"]);
    expect(res).toEqual({ drafted: 2, blocked: 0, skipped: 0, failed: 1 });
  });

  it("respects the limit, both in the loader request and in what it processes", async () => {
    const { deps, log } = setup(["a", "b", "c", "d", "e"], {});
    const res = await runNudgerBatch(3, deps);
    expect(log.loadLimit).toBe(3);
    expect(log.drafted).toEqual(["a", "b", "c"]);
    expect(res.drafted).toBe(3);
  });

  it("defaults to a limit of 10", async () => {
    const { deps, log } = setup([], {});
    await runNudgerBatch(undefined, deps);
    expect(log.loadLimit).toBe(10);
  });

  it("stops after 3 consecutive provider failures", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const { deps, log } = setup(ids, { a: providerDown, b: providerDown, c: providerDown });
    const res = await runNudgerBatch(10, deps);
    expect(PROVIDER_FAILURE_STOP).toBe(3);
    expect(log.drafted).toEqual(["a", "b", "c"]);
    expect(res).toEqual({ drafted: 0, blocked: 0, skipped: 3, failed: 0 });
  });

  it("does not stop when provider failures are interrupted by another outcome", async () => {
    const { deps, log } = setup(["a", "b", "c", "d", "e", "f"], { a: providerDown, b: providerDown, c: drafted, d: providerDown, e: providerDown });
    await runNudgerBatch(10, deps);
    expect(log.drafted).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("a thrown error from the candidate loader propagates (the cron wrapper isolates it)", async () => {
    const { deps } = setup([], {}, { loadCandidates: async () => { throw new Error("db down"); } });
    await expect(runNudgerBatch(10, deps)).rejects.toThrow("db down");
  });

  it("marks every candidate as considered BEFORE drafting it, including ones that fail or hit a provider error", async () => {
    const { deps, log } = setup(["a", "b", "c"], { a: new Error("boom"), b: providerDown });
    await runNudgerBatch(10, deps);
    expect(log.events).toEqual(["mark:a", "draft:a", "mark:b", "draft:b", "mark:c", "draft:c"]);
  });

  it("still drafts nothing for a candidate whose marker could not be written, and carries on", async () => {
    const { deps, log } = setup(["a", "b"], {}, { markConsidered: async (id) => { if (id === "a") throw new Error("db"); } });
    const res = await runNudgerBatch(10, deps);
    expect(log.drafted).toEqual(["b"]);
    expect(res).toEqual({ drafted: 1, blocked: 0, skipped: 0, failed: 1 });
  });
});

describe("wall-clock budget", () => {
  it("starts no new customer once the budget is exhausted (fake clock)", async () => {
    let t = 0;
    const started: string[] = [];
    const deps: BatchDeps = {
      isEnabled: async () => true, now: () => new Date(t),
      loadCandidates: async () => ["a", "b", "c", "d", "e"],
      markConsidered: async () => {},
      draft: async (id) => { started.push(id); t += 40_000; return drafted; },
    };
    const res = await runNudgerBatch(10, deps, 90_000);
    expect(started).toEqual(["a", "b", "c"]); // starts at 0, 40 s, 80 s; the 4th would start at 120 s
    expect(res.drafted).toBe(3);
    expect(DEFAULT_BUDGET_MS).toBe(90_000);
  });
  it("a zero budget starts nobody", async () => {
    const { deps, log } = setup(["a"], {});
    await runNudgerBatch(10, deps, 0);
    expect(log.drafted).toEqual([]);
  });
});

describe("provider failure streak semantics", () => {
  it("only provider failures count; a thrown error is a different failure and resets the streak", async () => {
    const { deps, log } = setup(["a", "b", "c", "d", "e", "f"], { a: providerDown, b: providerDown, c: new Error("db"), d: providerDown, e: providerDown, f: providerDown });
    await runNudgerBatch(10, deps);
    expect(log.drafted).toEqual(["a", "b", "c", "d", "e", "f"]); // stops only after f: d, e, f are 3 in a row
    const second = setup(["a", "b", "c", "d"], { a: providerDown, b: providerDown, c: providerDown });
    await runNudgerBatch(10, second.deps);
    expect(second.log.drafted).toEqual(["a", "b", "c"]);
  });
});

describe("candidate rotation (in-memory simulation)", () => {
  it("reaches all 100 clean customers within ceil(115/10) ticks although 15 are skipped forever", async () => {
    const skippers = Array.from({ length: 15 }, (_, i) => `s${i}`);
    const clean = Array.from({ length: 100 }, (_, i) => `k${i}`);
    const considered = new Map<string, number>();
    const done = new Set<string>();
    let tick = 0;
    const deps: BatchDeps = {
      isEnabled: async () => true,
      now: () => new Date(tick * 1000),
      // never-considered first, then least recently considered; drafted customers drop out (cooldown)
      loadCandidates: async (limit) => [...skippers, ...clean].filter((id) => !done.has(id)).sort((a, b) => (considered.get(a) ?? -1) - (considered.get(b) ?? -1)).slice(0, limit),
      markConsidered: async (id, now) => { considered.set(id, now.getTime()); },
      draft: async (id) => { if (id.startsWith("s")) return skipped("customer has an open issue"); done.add(id); return drafted; },
    };
    const TICKS = Math.ceil(115 / 10);
    for (tick = 1; tick <= TICKS; tick++) await runNudgerBatch(10, deps);
    expect(done.size).toBe(100);
  });

  it("orders never-considered first, then least recently considered", async () => {
    const considered = new Map<string, number>([["old", 1], ["new", 5]]);
    const order = ["new", "old", "fresh"].sort((a, b) => (considered.get(a) ?? -1) - (considered.get(b) ?? -1));
    expect(order).toEqual(["fresh", "old", "new"]);
  });
});
