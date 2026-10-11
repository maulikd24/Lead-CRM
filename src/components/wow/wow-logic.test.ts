import { describe, expect, it } from "vitest";

import { areaPath, computeDelta, formatValue, hasHistory, lerpValues, linePath, nearestIndex, niceMax, splitHalves, stepIndex, tickValues, trailingWindows, xLabelIndices } from "./wow-logic";

describe("computeDelta (vs last period)", () => {
  it("is a percentage with a direction", () => {
    expect(computeDelta(120, 100)).toEqual({ pct: 20, direction: "up" });
    expect(computeDelta(80, 100)).toEqual({ pct: -20, direction: "down" });
    expect(computeDelta(100, 100)).toEqual({ pct: 0, direction: "flat" });
  });
  it("has no percentage when the last period was zero, so nothing is invented", () => {
    expect(computeDelta(5, 0)).toBeNull();
    expect(computeDelta(0, 0)).toBeNull();
  });
  it("is absent when either side is unknown", () => {
    expect(computeDelta(null, 3)).toBeNull();
    expect(computeDelta(3, null)).toBeNull();
    expect(computeDelta(Number.NaN, 3)).toBeNull();
  });
  it("rounds to one decimal under 10 percent and whole numbers above", () => {
    expect(computeDelta(103.46, 100)?.pct).toBe(3.5);
    expect(computeDelta(133.4, 100)?.pct).toBe(33);
  });
});

describe("windows over a daily series", () => {
  const s = [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2];
  it("splits into the last n days and the n days before", () => {
    expect(trailingWindows(s, 7)).toEqual({ current: 14, previous: 7 });
  });
  it("is absent when there are fewer than 2n days of history", () => {
    expect(trailingWindows(s, 8)).toBeNull();
  });
  it("splits a range into halves for charts that have no earlier period", () => {
    expect(splitHalves([1, 2, 3, 4])).toEqual({ current: 7, previous: 3 });
    expect(splitHalves([1])).toBeNull();
  });
});

describe("hasHistory (no sparkline without real history)", () => {
  it("needs two points and at least one non-zero value", () => {
    expect(hasHistory(undefined)).toBe(false);
    expect(hasHistory([])).toBe(false);
    expect(hasHistory([4])).toBe(false);
    expect(hasHistory([0, 0, 0, 0])).toBe(false);
    expect(hasHistory([0, 0, 3])).toBe(true);
  });
});

describe("paths", () => {
  it("draws a line through every point inside the box", () => {
    const d = linePath([0, 5, 10], { w: 100, h: 50, pad: 0 });
    expect(d.startsWith("M0 50")).toBe(true);
    expect(d.endsWith("100 0")).toBe(true);
  });
  it("closes an area down to the baseline", () => {
    const d = areaPath([1, 2, 3], { w: 90, h: 30, pad: 0 });
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("L90 30");
  });
  it("keeps a flat series in the middle instead of dividing by zero", () => {
    const d = linePath([4, 4, 4], { w: 10, h: 10, pad: 0 });
    expect(d).not.toContain("NaN");
  });
  it("accepts a shared scale so two series can be compared", () => {
    const a = linePath([0, 5], { w: 10, h: 10, pad: 0, min: 0, max: 10 });
    expect(a.endsWith("10 5")).toBe(true);
  });
});

describe("scale helpers", () => {
  it("rounds a maximum up to a readable number", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(41)).toBe(50);
  });
  it("gives evenly spaced ticks from zero", () => {
    expect(tickValues(100, 4)).toEqual([0, 25, 50, 75, 100]);
  });
});

describe("morph between series", () => {
  it("is the start at 0 and the end at 1", () => {
    expect(lerpValues([0, 10], [10, 20], 0)).toEqual([0, 10]);
    expect(lerpValues([0, 10], [10, 20], 1)).toEqual([10, 20]);
    expect(lerpValues([0, 10], [10, 20], 0.5)).toEqual([5, 15]);
  });
  it("copes with a different number of points by resampling the shorter side", () => {
    expect(lerpValues([0, 10], [0, 5, 10], 0)).toHaveLength(3);
  });
});

describe("hover and keyboard", () => {
  it("finds the nearest point to a pointer", () => {
    expect(nearestIndex(0, 100, 5)).toBe(0);
    expect(nearestIndex(100, 100, 5)).toBe(4);
    expect(nearestIndex(51, 100, 5)).toBe(2);
    expect(nearestIndex(-20, 100, 5)).toBe(0);
    expect(nearestIndex(500, 100, 5)).toBe(4);
  });
  it("steps the crosshair with the arrow keys and stops at the ends", () => {
    expect(stepIndex("ArrowRight", null, 5)).toBe(0);
    expect(stepIndex("ArrowRight", 2, 5)).toBe(3);
    expect(stepIndex("ArrowLeft", 0, 5)).toBe(0);
    expect(stepIndex("ArrowRight", 4, 5)).toBe(4);
    expect(stepIndex("Home", 3, 5)).toBe(0);
    expect(stepIndex("End", 1, 5)).toBe(4);
    expect(stepIndex("Escape", 1, 5)).toBeNull();
    expect(stepIndex("a", 1, 5)).toBe(1);
  });
});

describe("formatValue", () => {
  it("formats counts and percentages", () => {
    expect(formatValue({ kind: "count" }, 1234567)).toBe("12,34,567");
    expect(formatValue({ kind: "percent", decimals: 1 }, 12.34)).toBe("12.3%");
  });
  it("shows rupees in full for a tooltip and compact on an axis", () => {
    expect(formatValue({ kind: "inr" }, 1234567)).toBe("₹12,34,567");
    expect(formatValue({ kind: "inr" }, 520000, true)).toBe("₹5.2L");
    expect(formatValue({ kind: "inr" }, 30000000, true)).toBe("₹3Cr");
    expect(formatValue({ kind: "inr" }, 4500, true)).toBe("₹4.5K");
  });
  it("falls back to a plain number when the currency is unknown", () => {
    expect(formatValue({ kind: "money", currency: null }, 1500)).toBe("1,500");
    expect(formatValue({ kind: "money", currency: "INR" }, 1500)).toContain("1,500");
  });
  it("never prints NaN", () => {
    expect(formatValue({ kind: "count" }, Number.NaN)).toBe("—");
  });
});

describe("xLabelIndices", () => {
  it("shows every label when there are few", () => {
    expect(xLabelIndices(4, 6)).toEqual([0, 1, 2, 3]);
  });
  it("thins a long axis but keeps both ends", () => {
    const idx = xLabelIndices(30, 6);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(29);
    expect(idx.length).toBeLessThanOrEqual(6);
  });
});
