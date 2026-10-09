import { describe, expect, it } from "vitest";
import { assignVariant, compareVariants, twoProportionZTest } from "./variant";

describe("assignVariant", () => {
  it("is deterministic for the same client and experiment", () => {
    for (let i = 0; i < 50; i++) expect(assignVariant(`c${i}`, "exp1", 0.5)).toBe(assignVariant(`c${i}`, "exp1", 0.5));
  });
  it("differs across experiments (independent buckets)", () => {
    let differing = 0;
    for (let i = 0; i < 400; i++) if (assignVariant(`c${i}`, "exp1", 0.5) !== assignVariant(`c${i}`, "exp2", 0.5)) differing++;
    expect(differing).toBeGreaterThan(120);
    expect(differing).toBeLessThan(280);
  });
  it("is roughly uniform on 10,000 ids for a 50/50 split", () => {
    let b = 0;
    for (let i = 0; i < 10_000; i++) if (assignVariant(`client-${i}`, "nudge-tone", 0.5) === "B") b++;
    expect(b).toBeGreaterThan(4_800);
    expect(b).toBeLessThan(5_200);
  });
  it("honours an uneven split", () => {
    let b = 0;
    for (let i = 0; i < 10_000; i++) if (assignVariant(`client-${i}`, "nudge-tone", 0.2) === "B") b++;
    expect(b / 10_000).toBeGreaterThan(0.18);
    expect(b / 10_000).toBeLessThan(0.22);
  });
  it("handles the 0 and 1 boundaries", () => {
    expect(assignVariant("x", "e", 0)).toBe("A");
    expect(assignVariant("x", "e", 1)).toBe("B");
  });
  it("rejects an invalid split", () => {
    expect(() => assignVariant("x", "e", 1.5)).toThrow();
    expect(() => assignVariant("x", "e", Number.NaN)).toThrow();
    expect(() => assignVariant("x", "e", {})).toThrow();
  });
  it("supports named weighted variants", () => {
    const counts: Record<string, number> = { control: 0, warm: 0, short: 0 };
    for (let i = 0; i < 10_000; i++) counts[assignVariant(`k${i}`, "multi", { control: 2, warm: 1, short: 1 })]++;
    expect(counts.control / 10_000).toBeGreaterThan(0.47);
    expect(counts.control / 10_000).toBeLessThan(0.53);
    expect(counts.warm / 10_000).toBeGreaterThan(0.22);
    expect(counts.short / 10_000).toBeGreaterThan(0.22);
  });
});

describe("twoProportionZTest", () => {
  it("returns null with a zero denominator", () => {
    expect(twoProportionZTest({ successes: 0, n: 0 }, { successes: 1, n: 10 })).toBeNull();
  });
  it("returns null when both proportions are identical extremes (zero variance)", () => {
    expect(twoProportionZTest({ successes: 0, n: 50 }, { successes: 0, n: 50 })).toBeNull();
    expect(twoProportionZTest({ successes: 50, n: 50 }, { successes: 50, n: 50 })).toBeNull();
  });
  it("matches a hand-computed case", () => {
    // 60/200 vs 40/200: pooled 0.25, se = sqrt(.25*.75*(2/200)) = 0.04330; z = 0.10/0.04330 = 2.309; p ~ 0.0209
    const r = twoProportionZTest({ successes: 60, n: 200 }, { successes: 40, n: 200 })!;
    expect(r.z).toBeCloseTo(2.309, 2);
    expect(r.pValue).toBeCloseTo(0.0209, 3);
    expect(r.diff).toBeCloseTo(0.1, 6);
  });
  it("is symmetric in sign", () => {
    const r = twoProportionZTest({ successes: 40, n: 200 }, { successes: 60, n: 200 })!;
    expect(r.z).toBeCloseTo(-2.309, 2);
    expect(r.pValue).toBeCloseTo(0.0209, 3);
  });
  it("gives p near 1 when equal", () => {
    expect(twoProportionZTest({ successes: 20, n: 100 }, { successes: 20, n: 100 })!.pValue).toBeCloseTo(1, 5);
  });
});

describe("compareVariants", () => {
  it("labels small samples too early even when the gap looks big", () => {
    const r = compareVariants({ successes: 9, n: 10 }, { successes: 1, n: 10 });
    expect(r.status).toBe("too_early");
  });
  it("boundary: exactly the minimum sample on both arms is evaluated", () => {
    expect(compareVariants({ successes: 25, n: 30 }, { successes: 5, n: 30 }, { minSample: 30 }).status).toBe("significant");
    expect(compareVariants({ successes: 25, n: 30 }, { successes: 5, n: 29 }, { minSample: 30 }).status).toBe("too_early");
  });
  it("reports not significant for a small gap", () => {
    expect(compareVariants({ successes: 52, n: 100 }, { successes: 48, n: 100 }).status).toBe("not_significant");
  });
  it("names the better arm when significant", () => {
    const r = compareVariants({ successes: 60, n: 200 }, { successes: 40, n: 200 });
    expect(r.status).toBe("significant");
    expect(r.better).toBe("a");
    expect(compareVariants({ successes: 40, n: 200 }, { successes: 60, n: 200 }).better).toBe("b");
  });
  it("is not_significant (not a crash) with zero variance", () => {
    expect(compareVariants({ successes: 0, n: 50 }, { successes: 0, n: 50 }).status).toBe("not_significant");
  });
  it("too early with zero denominators", () => {
    expect(compareVariants({ successes: 0, n: 0 }, { successes: 0, n: 0 }).status).toBe("too_early");
  });
});
