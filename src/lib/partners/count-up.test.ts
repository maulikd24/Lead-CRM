import { describe, expect, it } from "vitest";
import { countUpValue, easeOutCubic } from "./count-up";

describe("count-up maths", () => {
  it("eases from 0 to 1, clamped", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-3)).toBe(0);
    expect(easeOutCubic(9)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
  it("lands exactly on the target", () => {
    expect(countUpValue(940, 1, true)).toBe(940);
    expect(countUpValue(184250.5, 1, false)).toBe(184250.5);
  });
  it("rounds whole-number targets as it climbs", () => {
    expect(Number.isInteger(countUpValue(940, 0.37, true))).toBe(true);
  });
});
