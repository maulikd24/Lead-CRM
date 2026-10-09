import { describe, expect, it } from "vitest";
import { findCandidatePairs, MAX_BUCKET_SIZE } from "./candidate-pairs";
import type { Identity } from "./duplicate-score";

const row = (id: string, o: Partial<Identity> = {}): Identity => ({ id, name: `P ${id}`, mobile: null, email: null, pan: null, ...o });
const ids = (r: ReturnType<typeof findCandidatePairs>) => r.pairs.map(([x, y]) => `${x.id}:${y.id}`).sort();

describe("findCandidatePairs", () => {
  it("makes 3 ordered pairs for 3 clients sharing a mobile", () => {
    const r = findCandidatePairs([row("c", { mobile: "98765 43210" }), row("a", { mobile: "+919876543210" }), row("b", { mobile: "9876543210" })]);
    expect(ids(r)).toEqual(["a:b", "a:c", "b:c"]);
  });
  it("does not duplicate a pair found in both the mobile and email buckets", () => {
    const r = findCandidatePairs([row("2", { mobile: "9876543210", email: "X@e.com" }), row("1", { mobile: "9876543210", email: "x@e.com" })]);
    expect(ids(r)).toEqual(["1:2"]);
  });
  it("ignores blank or null contacts", () => {
    expect(findCandidatePairs([row("1", { mobile: "" }), row("2", { mobile: "" }), row("3"), row("4")]).pairs).toEqual([]);
  });
  it("does not bucket on PAN (PAN collisions are blocked at creation)", () => {
    expect(findCandidatePairs([row("1", { pan: "ABCDE1234F" }), row("2", { pan: "ABCDE1234F" })]).pairs).toEqual([]);
  });
  it("skips and reports buckets larger than the cap", () => {
    const big = Array.from({ length: MAX_BUCKET_SIZE + 1 }, (_, i) => row(`id${String(i).padStart(3, "0")}`, { mobile: "9111111111" }));
    const r = findCandidatePairs([...big, row("x1", { mobile: "9222222222" }), row("x2", { mobile: "9222222222" })]);
    expect(ids(r)).toEqual(["x1:x2"]);
    expect(r.skippedBuckets).toEqual([{ kind: "mobile", key: "9111111111", size: MAX_BUCKET_SIZE + 1 }]);
  });
  it("still processes a bucket exactly at the cap", () => {
    const rows = Array.from({ length: MAX_BUCKET_SIZE }, (_, i) => row(`id${String(i).padStart(3, "0")}`, { mobile: "9111111111" }));
    const r = findCandidatePairs(rows);
    expect(r.pairs.length).toBe((MAX_BUCKET_SIZE * (MAX_BUCKET_SIZE - 1)) / 2);
    expect(r.skippedBuckets).toEqual([]);
  });

  it("matches leading-zero and bare mobiles in one bucket", () => {
    expect(ids(findCandidatePairs([row("1", { mobile: "09876543210" }), row("2", { mobile: "9876543210" })]))).toEqual(["1:2"]);
  });
  it("creates no bucket for placeholder or short mobiles", () => {
    const rows = ["0000000000", "9999999999", "2212345"].flatMap((m) => [row(`${m}a`, { mobile: m }), row(`${m}b`, { mobile: m })]);
    const r = findCandidatePairs(rows);
    expect(r.pairs).toEqual([]);
    expect(r.skippedBuckets).toEqual([]);
  });
});
