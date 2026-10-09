import { describe, expect, it } from "vitest";

import { countUpValue, easeOutCubic, formatInrCompact, formatPercent } from "./count-up";

describe("easeOutCubic", () => {
  it("is 0 at 0 and 1 at 1 and monotonic", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let prev = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
  it("starts fast (ease out)", () => expect(easeOutCubic(0.5)).toBeGreaterThan(0.5));
  it("clamps out-of-range progress", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(3)).toBe(1);
    expect(easeOutCubic(Number.NaN)).toBe(0);
  });
});

describe("countUpValue", () => {
  it("interpolates and lands exactly on the target", () => {
    expect(countUpValue(0, 1000, 0)).toBe(0);
    expect(countUpValue(0, 1000, 1)).toBe(1000);
    expect(countUpValue(0, 1000, 0.5)).toBe(Math.round(1000 * easeOutCubic(0.5)));
  });
  it("counts down as well as up", () => expect(countUpValue(100, 0, 1)).toBe(0));
  it("respects decimals", () => expect(countUpValue(0, 12.345, 1, 2)).toBe(12.35));
  it("handles a non-finite target by returning 0", () => expect(countUpValue(0, Number.NaN, 0.5)).toBe(0));
});

describe("formatInrCompact", () => {
  it.each([
    [0, "₹0"],
    [12345, "₹12,345"],
    [250000, "₹2.50 L"],
    [12500000, "₹1.25 Cr"],
    [-250000, "-₹2.50 L"],
  ])("%d -> %s", (n, text) => expect(formatInrCompact(n)).toBe(text));
  it("falls back for non-finite input", () => expect(formatInrCompact(Number.NaN)).toBe("₹0"));
});

describe("formatPercent", () => {
  it("renders one decimal", () => expect(formatPercent(41.666)).toBe("41.7%"));
});
