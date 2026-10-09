import { describe, expect, it } from "vitest";

import { buildRing, ringColorVar } from "./ring";

describe("buildRing", () => {
  const rows = [{ label: "Equity", value: 50 }, { label: "Mutual Fund", value: 30 }, { label: "Fixed Income", value: 20 }, { label: "PMS", value: 0 }];

  it("drops empty segments and computes percentages", () => {
    const ring = buildRing(rows, { radius: 50, strokeWidth: 10, gap: 0 });
    expect(ring.segments.map((s) => [s.label, s.pct])).toEqual([["Equity", 50], ["Mutual Fund", 30], ["Fixed Income", 20]]);
    expect(ring.total).toBe(100);
  });

  it("lays segments end to end around the circumference", () => {
    const ring = buildRing(rows, { radius: 50, strokeWidth: 10, gap: 0 });
    const C = 2 * Math.PI * 50;
    expect(ring.circumference).toBeCloseTo(C, 6);
    expect(ring.segments[0].length).toBeCloseTo(C * 0.5, 6);
    expect(ring.segments[0].offset).toBeCloseTo(0, 6);
    expect(ring.segments[1].offset).toBeCloseTo(-C * 0.5, 6);
    expect(ring.segments[2].offset).toBeCloseTo(-C * 0.8, 6);
    expect(ring.segments.reduce((s, x) => s + x.length, 0)).toBeCloseTo(C, 6);
  });

  it("leaves a gap between segments but none for a single segment", () => {
    const ring = buildRing(rows, { radius: 50, strokeWidth: 10, gap: 4 });
    expect(ring.segments[0].length).toBeCloseTo(2 * Math.PI * 50 * 0.5 - 4, 6);
    const single = buildRing([{ label: "Equity", value: 10 }], { radius: 50, strokeWidth: 10, gap: 4 });
    expect(single.segments[0].length).toBeCloseTo(2 * Math.PI * 50, 6);
  });

  it("never lets a gap eat a tiny segment", () => {
    const ring = buildRing([{ label: "a", value: 99.9 }, { label: "b", value: 0.1 }], { radius: 50, strokeWidth: 10, gap: 4 });
    expect(ring.segments.every((s) => s.length >= 0)).toBe(true);
  });

  it("is empty for no value and ignores negatives and NaN", () => {
    expect(buildRing([{ label: "a", value: 0 }], { radius: 50, strokeWidth: 10, gap: 2 }).segments).toEqual([]);
    expect(buildRing([{ label: "a", value: -5 }, { label: "b", value: Number.NaN }], { radius: 50, strokeWidth: 10, gap: 2 }).segments).toEqual([]);
  });

  it("assigns theme colour tokens by position and never a literal colour", () => {
    const ring = buildRing(rows, { radius: 50, strokeWidth: 10, gap: 0 });
    expect(ring.segments.map((s) => s.color)).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"]);
    expect(ringColorVar(5)).toBe("var(--muted-foreground)");
    expect(ringColorVar(9)).toBe("var(--muted-foreground)");
  });

  it("scales the viewBox to the radius and stroke", () => {
    expect(buildRing(rows, { radius: 50, strokeWidth: 10, gap: 0 }).viewBox).toBe(110);
  });
});
