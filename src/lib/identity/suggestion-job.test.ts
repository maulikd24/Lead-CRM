import { describe, expect, it, vi } from "vitest";
import { planSuggestionWrites, runMergeSuggestionJob, RESURFACE_DELTA, type JobDeps, type Anchor, type ExistingSuggestion } from "./suggestion-job";

const pair = { clientAId: "a", clientBId: "b" };
const ex = (over: Partial<ExistingSuggestion> = {}): ExistingSuggestion => ({ ...pair, status: "OPEN", score: 0.85, reasons: ["same mobile", "similar name"], ...over });
const sc = (over = {}) => ({ ...pair, score: 0.85, reasons: ["same mobile", "similar name"], ...over });

describe("planSuggestionWrites", () => {
  it("creates new pairs", () => expect(planSuggestionWrites([sc()], []).create).toHaveLength(1));
  it("leaves an unchanged OPEN pair alone, refreshes a changed one", () => {
    expect(planSuggestionWrites([sc()], [ex()])).toEqual({ create: [], refresh: [], reopen: [] });
    expect(planSuggestionWrites([sc({ score: 0.9 })], [ex()]).refresh).toHaveLength(1);
  });
  it("never touches MERGED", () => expect(planSuggestionWrites([sc({ score: 0.99 })], [ex({ status: "MERGED" })])).toEqual({ create: [], refresh: [], reopen: [] }));
  it("does not resurface a DISMISSED pair for a small score change", () => {
    expect(planSuggestionWrites([sc({ score: 0.85 + RESURFACE_DELTA - 0.01 })], [ex({ status: "DISMISSED" })]).reopen).toEqual([]);
    expect(planSuggestionWrites([sc({ score: 0.7 })], [ex({ status: "DISMISSED" })]).reopen).toEqual([]);
  });
  it("resurfaces a DISMISSED pair when the score rises materially", () => {
    const r = planSuggestionWrites([sc({ score: 0.85 + RESURFACE_DELTA })], [ex({ status: "DISMISSED" })]);
    expect(r.reopen).toHaveLength(1);
    expect(r.create).toEqual([]);
  });
  it("resurfaces a DISMISSED pair that now shares a PAN", () => {
    expect(planSuggestionWrites([sc({ score: 0.98, reasons: ["same PAN"] })], [ex({ status: "DISMISSED", score: 0.97 })]).reopen).toHaveLength(1);
  });
});

const anchor = (id: string, createdAt: string, over: Partial<Anchor> = {}): Anchor => ({ id, name: "Riya Sharma", mobile: "9876543210", email: null, pan: null, createdAt: new Date(createdAt), ...over });

function fake(over: Partial<JobDeps> & { anchors?: Anchor[]; partners?: Anchor[] } = {}) {
  let cursor: Date | null = null;
  let rest: Date | null = null;
  const all = over.anchors ?? [];
  const written: unknown[] = [];
  const deps: JobDeps = {
    enabled: () => true,
    now: () => new Date("2026-10-09T12:00:00Z"),
    loadState: async () => ({ cursor, restUntil: rest }),
    saveCursor: vi.fn(async (c) => { cursor = c; }),
    saveRestUntil: vi.fn(async (d) => { rest = d; }),
    loadAnchors: vi.fn(async (after, limit) => all.filter((a) => !after || a.createdAt > after).sort((x, y) => +x.createdAt - +y.createdAt).slice(0, limit)),
    loadPartners: vi.fn(async () => over.partners ?? []),
    loadExisting: vi.fn(async () => []),
    write: vi.fn(async (p) => { written.push(p); }),
    ...over,
  };
  return { deps, written, state: () => ({ cursor, rest }) };
}

describe("runMergeSuggestionJob", () => {
  it("is a no-op when the flag is off", async () => {
    const f = fake({ enabled: () => false, anchors: [anchor("a", "2026-01-01")] });
    expect(await runMergeSuggestionJob(f.deps)).toMatchObject({ skipped: "disabled" });
    expect(f.deps.loadAnchors).not.toHaveBeenCalled();
    expect(f.deps.write).not.toHaveBeenCalled();
  });
  it("rests between passes", async () => {
    const f = fake({ anchors: [] });
    const now = new Date("2026-10-09T12:00:00Z");
    f.deps.loadState = async () => ({ cursor: null, restUntil: new Date(now.getTime() + 1000) });
    expect(await runMergeSuggestionJob(f.deps)).toMatchObject({ skipped: "resting" });
  });
  it("finds a pair between an anchor and an OLD partner outside the window, and writes it", async () => {
    const f = fake({ anchors: [anchor("n1", "2026-10-01")], partners: [anchor("old", "2024-01-01")] });
    const r = await runMergeSuggestionJob(f.deps);
    expect(r).toMatchObject({ created: 1, anchors: 1, completedPass: true });
    expect((f.written[0] as { create: { clientAId: string; clientBId: string }[] }).create[0]).toMatchObject({ clientAId: "n1", clientBId: "old" });
  });
  it("ignores pairs where neither side is in this window (they belong to another window)", async () => {
    const f = fake({ anchors: [anchor("n1", "2026-10-01", { mobile: "9111111111" })], partners: [anchor("x", "2024-01-01"), anchor("y", "2024-01-02")] });
    expect(await runMergeSuggestionJob(f.deps)).toMatchObject({ created: 0 });
  });
  it("advances the cursor chunk by chunk and rotates through every client over several ticks", async () => {
    const anchors = ["1", "2", "3", "4", "5"].map((id, i) => anchor(id, `2026-01-0${i + 1}`, { mobile: `90000000${id}0`.slice(0, 10) }));
    const f = fake({ anchors });
    const opts = { chunk: 2, maxChunks: 1 };
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await runMergeSuggestionJob(f.deps, opts);
      const calls = (f.deps.loadAnchors as ReturnType<typeof vi.fn>).mock.results;
      for (const c of calls) for (const a of await c.value) seen.push(a.id);
      if (f.state().rest) break;
    }
    expect(new Set(seen)).toEqual(new Set(["1", "2", "3", "4", "5"]));
    expect(f.state().rest).not.toBeNull();
    expect(f.state().cursor).toBeNull();
  });
  it("stops starting new chunks once the time budget is spent", async () => {
    let t = 0;
    const f = fake({ anchors: [anchor("1", "2026-01-01"), anchor("2", "2026-01-02"), anchor("3", "2026-01-03")], now: () => new Date(1_000_000 + (t += 40_000)) });
    const r = await runMergeSuggestionJob(f.deps, { chunk: 1, budgetMs: 50_000 });
    expect(r.anchors).toBeLessThan(3);
    expect(r.completedPass).toBe(false);
  });
  it("never saves the cursor past a chunk that failed", async () => {
    const f = fake({ anchors: [anchor("1", "2026-01-01")], partners: [anchor("old", "2024-01-01")], write: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(runMergeSuggestionJob(f.deps)).rejects.toThrow("db down");
    expect(f.deps.saveCursor).not.toHaveBeenCalled();
  });
});
