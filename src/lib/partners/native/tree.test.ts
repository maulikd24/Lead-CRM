import { describe, expect, it } from "vitest";

import { flattenForest, rollupTotals, subtreeIds } from "./tree";

const n = (id: string, parentId: string | null = null) => ({ id, parentId });
// a
// ├─ b
// │  └─ d
// └─ c
// e (separate root)
const NODES = [n("a"), n("b", "a"), n("c", "a"), n("d", "b"), n("e")];

describe("subtreeIds", () => {
  it("returns the root and everything below it", () => {
    expect(subtreeIds(["a"], NODES).sort()).toEqual(["a", "b", "c", "d"]);
    expect(subtreeIds(["b"], NODES).sort()).toEqual(["b", "d"]);
    expect(subtreeIds(["e"], NODES)).toEqual(["e"]);
  });
  it("unions several roots without duplicates", () => {
    expect(subtreeIds(["a", "b"], NODES).sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("ignores a root that does not exist rather than inventing a partner", () => {
    expect(subtreeIds(["zzz"], NODES)).toEqual([]);
  });
  it("survives a cycle in the data", () => {
    const loop = [n("x", "y"), n("y", "x")];
    expect(subtreeIds(["x"], loop).sort()).toEqual(["x", "y"]);
  });
});

describe("flattenForest", () => {
  it("orders depth first with children under their parent, and gives depth", () => {
    const flat = flattenForest(NODES);
    expect(flat.map((r) => [r.id, r.depth])).toEqual([["a", 0], ["b", 1], ["d", 2], ["c", 1], ["e", 0]]);
    expect(flat.find((r) => r.id === "a")!.childCount).toBe(2);
    expect(flat.find((r) => r.id === "d")!.childCount).toBe(0);
  });
  it("makes a partner whose parent is outside the list a root (a scoped view)", () => {
    const flat = flattenForest([n("b", "a"), n("d", "b")]);
    expect(flat.map((r) => [r.id, r.depth])).toEqual([["b", 0], ["d", 1]]);
  });
  it("keeps every node of a cycle exactly once", () => {
    const flat = flattenForest([n("x", "y"), n("y", "x"), n("z")]);
    expect(flat.map((r) => r.id).sort()).toEqual(["x", "y", "z"]);
  });
  it("stops descending past the maximum depth and says so", () => {
    const chain = [n("a"), n("b", "a"), n("c", "b"), n("d", "c")];
    const flat = flattenForest(chain, { maxDepth: 2 });
    expect(flat.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(flat.find((r) => r.id === "c")!.truncated).toBe(true);
  });
  it("is stable for the same input, sorted by id within a level", () => {
    const flat = flattenForest([n("p"), n("k2", "p"), n("k1", "p")]);
    expect(flat.map((r) => r.id)).toEqual(["p", "k1", "k2"]);
  });
});

describe("rollupTotals", () => {
  it("adds each partner's own amount to everything below them", () => {
    const own = new Map<string, bigint>([["a", BigInt(100)], ["b", BigInt(50)], ["c", BigInt(25)], ["d", BigInt(10)], ["e", BigInt(7)]]);
    const out = rollupTotals(NODES, own);
    expect(out.get("a")).toBe(BigInt(185));
    expect(out.get("b")).toBe(BigInt(60));
    expect(out.get("c")).toBe(BigInt(25));
    expect(out.get("e")).toBe(BigInt(7));
  });
  it("treats a partner with no entry as zero", () => {
    expect(rollupTotals(NODES, new Map()).get("a")).toBe(BigInt(0));
  });
  it("does not double count in a cycle", () => {
    const out = rollupTotals([n("x", "y"), n("y", "x")], new Map([["x", BigInt(1)], ["y", BigInt(2)]]));
    expect(out.get("x")! + BigInt(0)).toBeGreaterThanOrEqual(BigInt(1));
    expect(out.get("x")).toBeLessThanOrEqual(BigInt(3));
  });
});
