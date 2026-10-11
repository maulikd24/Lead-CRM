import { describe, expect, it } from "vitest";

import { DEFAULT_FATIGUE_THRESHOLDS, detectFatigue, type DailyPoint } from "./fatigue";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);

/** n days of delivery; `shape(i)` returns the numbers of day i. */
function series(n: number, shape: (i: number) => Partial<DailyPoint>): DailyPoint[] {
  return Array.from({ length: n }, (_, i) => ({ date: day(i), impressions: 4000, clicks: 80, spend: 2000, leads: 4, ...shape(i) }));
}

describe("detectFatigue", () => {
  it("says there is not enough data rather than guessing on a short run", () => {
    const r = detectFatigue(series(6, () => ({})));
    expect(r.status).toBe("insufficient");
    expect(r.signals).toEqual([]);
    expect(r.note).toMatch(/at least 10 days/i);
  });

  it("calls a steady ad healthy", () => {
    const r = detectFatigue(series(14, () => ({})));
    expect(r.status).toBe("ok");
    expect(r.signals).toEqual([]);
  });

  it("flags a click-through rate that decays over the days", () => {
    const r = detectFatigue(series(14, (i) => ({ clicks: i < 9 ? 100 : 56 })));
    const s = r.signals.find((x) => x.kind === "ctr_decay");
    expect(s).toBeDefined();
    expect(s!.changePct).toBeGreaterThanOrEqual(25);
    expect(r.status).toBe("watch");
  });

  it("flags cost per lead drifting up", () => {
    const r = detectFatigue(series(14, (i) => ({ leads: i < 9 ? 5 : 3 })));
    expect(r.signals.map((x) => x.kind)).toContain("cpl_drift");
  });

  it("calls an ad fatigued when two signals agree", () => {
    const r = detectFatigue(series(14, (i) => ({ clicks: i < 9 ? 100 : 50, leads: i < 9 ? 5 : 2 })));
    expect(r.status).toBe("fatigued");
    expect(r.signals.length).toBeGreaterThanOrEqual(2);
  });

  it("uses frequency only when reach is reported, and says so when it is not", () => {
    const without = detectFatigue(series(14, () => ({})));
    expect(without.frequency).toEqual({ state: "not_reported" });
    const high = detectFatigue(series(14, () => ({ reach: 1000 })));
    expect(high.frequency).toMatchObject({ state: "reported" });
    expect(high.signals.map((x) => x.kind)).toContain("frequency");
  });

  it("does not judge click-through on thin delivery", () => {
    const r = detectFatigue(series(14, (i) => ({ impressions: 100, clicks: i < 9 ? 5 : 1 })));
    expect(r.signals.map((x) => x.kind)).not.toContain("ctr_decay");
    expect(r.checks.ctr).toBe("insufficient");
  });

  it("does not judge cost per lead on too few leads", () => {
    const r = detectFatigue(series(14, (i) => ({ leads: i < 9 ? 1 : 0 })));
    expect(r.checks.cpl).toBe("insufficient");
  });

  it("thresholds are configurable", () => {
    const rows = series(14, (i) => ({ clicks: i < 9 ? 100 : 90 }));
    expect(detectFatigue(rows).signals).toEqual([]);
    const strict = detectFatigue(rows, { ...DEFAULT_FATIGUE_THRESHOLDS, ctrDecayPct: 5 });
    expect(strict.signals.map((x) => x.kind)).toContain("ctr_decay");
  });

  it("ignores row order", () => {
    const rows = series(14, (i) => ({ clicks: i < 9 ? 100 : 50 }));
    expect(detectFatigue([...rows].reverse()).signals).toEqual(detectFatigue(rows).signals);
  });
});
