import { describe, expect, it } from "vitest";

import { describePeriodDelta } from "./period-comparison";
import { parseManagementPeriodParams, previousPeriodRange } from "./period-range";

const d = (s: string) => new Date(s);

describe("previousPeriodRange", () => {
  it("compares a finished month with the whole month before", () => {
    const now = d("2026-10-12T10:00:00");
    const p = parseManagementPeriodParams({ period: "month", anchor: "2026-09-15" }, now);
    const prev = previousPeriodRange(p, now);
    expect(prev.from).toEqual(d("2026-08-01T00:00:00"));
    expect(prev.to).toEqual(d("2026-08-31T23:59:59.999"));
  });

  it("compares a month in progress with the same elapsed span of last month", () => {
    const now = d("2026-10-12T10:00:00");
    const p = parseManagementPeriodParams({ period: "month" }, now);
    const prev = previousPeriodRange(p, now);
    expect(prev.from).toEqual(d("2026-09-01T00:00:00"));
    expect(prev.to).toEqual(d("2026-09-12T10:00:00"));
  });

  it("never runs past the end of a shorter previous period", () => {
    const now = d("2026-03-31T12:00:00");
    const p = parseManagementPeriodParams({ period: "month" }, now);
    expect(previousPeriodRange(p, now).to).toEqual(d("2026-02-28T23:59:59.999"));
  });

  it("compares a quarter with the quarter before", () => {
    const now = d("2026-10-12T10:00:00");
    const p = parseManagementPeriodParams({ period: "quarter", anchor: "2026-08-01" }, now);
    const prev = previousPeriodRange(p, now);
    expect(prev.from).toEqual(d("2026-04-01T00:00:00"));
    expect(prev.to).toEqual(d("2026-06-30T23:59:59.999"));
  });

  it("compares a custom range with the same number of days just before it", () => {
    const now = d("2026-10-12T10:00:00");
    const p = parseManagementPeriodParams({ period: "custom", from: "2026-09-11", to: "2026-09-20" }, now);
    const prev = previousPeriodRange(p, now);
    expect(prev.from).toEqual(d("2026-09-01T00:00:00"));
    expect(prev.to).toEqual(d("2026-09-10T23:59:59.999"));
  });
});

describe("describePeriodDelta", () => {
  it("has nothing to say when both periods are zero", () => {
    expect(describePeriodDelta(0, 0)).toBeNull();
  });
  it("calls a rise from zero new rather than an infinite percentage", () => {
    expect(describePeriodDelta(5, 0)).toEqual({ text: "New", tone: "good" });
  });
  it("shows a rise and a fall as good and bad", () => {
    expect(describePeriodDelta(112, 100)).toEqual({ text: "▲ 12%", tone: "good" });
    expect(describePeriodDelta(75, 100)).toEqual({ text: "▼ 25%", tone: "bad" });
  });
  it("treats a fall as good news when lower is better", () => {
    expect(describePeriodDelta(8, 10, { lowerIsBetter: true })).toEqual({ text: "▼ 20%", tone: "good" });
    expect(describePeriodDelta(12, 10, { lowerIsBetter: true })).toEqual({ text: "▲ 20%", tone: "bad" });
  });
  it("rounds tiny moves to no change", () => {
    expect(describePeriodDelta(1000, 1001)).toEqual({ text: "No change", tone: "flat" });
  });
});
