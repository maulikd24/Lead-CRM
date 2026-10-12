import { describe, expect, it } from "vitest";
import { RANGE_OPTIONS, insightsEnabled, resolveRange } from "./range";

const NOW = new Date("2026-10-09T12:00:00Z");

describe("resolveRange", () => {
  it("defaults to 30 days", () => {
    const r = resolveRange(undefined, NOW);
    expect(r.days).toBe(30);
    expect(r.to).toEqual(NOW);
    expect(NOW.getTime() - r.from.getTime()).toBe(30 * 86_400_000);
    expect(r.from.getTime() - r.prevFrom.getTime()).toBe(30 * 86_400_000);
  });
  it("accepts the offered options and nothing else", () => {
    for (const o of RANGE_OPTIONS) expect(resolveRange(String(o.days), NOW).days).toBe(o.days);
    expect(resolveRange("45", NOW).days).toBe(30);
    expect(resolveRange("-1", NOW).days).toBe(30);
    expect(resolveRange("abc", NOW).days).toBe(30);
    expect(resolveRange(["7", "90"], NOW).days).toBe(7);
  });
});

describe("insightsEnabled", () => {
  it("is on only for the exact value 1", () => {
    expect(insightsEnabled({ NEXT_PUBLIC_INSIGHTS: "1" })).toBe(true);
    expect(insightsEnabled({ NEXT_PUBLIC_INSIGHTS: "true" })).toBe(false);
    expect(insightsEnabled({ NEXT_PUBLIC_INSIGHTS: "0" })).toBe(false);
    expect(insightsEnabled({})).toBe(false);
  });
});
