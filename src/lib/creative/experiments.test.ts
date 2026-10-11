import { describe, expect, it } from "vitest";

import { guideSampleSize, normalCdfInverse, validateExperiment, planDecision } from "./experiments";

describe("normalCdfInverse", () => {
  it("matches known values", () => {
    expect(normalCdfInverse(0.975)).toBeCloseTo(1.96, 2);
    expect(normalCdfInverse(0.8)).toBeCloseTo(0.8416, 3);
    expect(normalCdfInverse(0.5)).toBeCloseTo(0, 6);
  });
});

describe("guideSampleSize (two-sided test, 5% significance, 80% power)", () => {
  it("matches the textbook figure for a 10% baseline and a 2 point absolute lift", () => {
    const g = guideSampleSize({ baselineRate: 0.1, mde: 0.02, mdeKind: "absolute" });
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.perArm).toBeGreaterThan(3500);
      expect(g.perArm).toBeLessThan(3900);
    }
  });

  it("treats a relative lift as a share of the baseline", () => {
    const rel = guideSampleSize({ baselineRate: 0.1, mde: 0.2, mdeKind: "relative" });
    const abs = guideSampleSize({ baselineRate: 0.1, mde: 0.02, mdeKind: "absolute" });
    expect(rel.ok && abs.ok && rel.perArm).toBe(abs.ok && abs.perArm);
  });

  it("needs more people for a smaller lift", () => {
    const a = guideSampleSize({ baselineRate: 0.05, mde: 0.5, mdeKind: "relative" });
    const b = guideSampleSize({ baselineRate: 0.05, mde: 0.1, mdeKind: "relative" });
    expect(a.ok && b.ok && b.perArm > a.perArm).toBe(true);
  });

  it("rejects nonsense input in words", () => {
    expect(guideSampleSize({ baselineRate: 0, mde: 0.1, mdeKind: "relative" })).toMatchObject({ ok: false });
    expect(guideSampleSize({ baselineRate: 1.2, mde: 0.1, mdeKind: "relative" })).toMatchObject({ ok: false });
    expect(guideSampleSize({ baselineRate: 0.1, mde: 0, mdeKind: "relative" })).toMatchObject({ ok: false });
    expect(guideSampleSize({ baselineRate: 0.95, mde: 0.2, mdeKind: "absolute" })).toMatchObject({ ok: false });
  });

  it("with low volume, estimates the time to finish and says when it is not realistic", () => {
    const slow = guideSampleSize({ baselineRate: 0.03, mde: 0.2, mdeKind: "relative", visitorsPerDay: 40, arms: 2 });
    expect(slow.ok).toBe(true);
    if (slow.ok) {
      expect(slow.days).toBeGreaterThan(90);
      expect(slow.realistic).toBe(false);
      expect(slow.advice.join(" ")).toMatch(/larger|bigger|directional|funnel/i);
    }
    const fast = guideSampleSize({ baselineRate: 0.1, mde: 0.5, mdeKind: "relative", visitorsPerDay: 2000, arms: 2 });
    expect(fast.ok && fast.realistic).toBe(true);
  });

  it("offers the smallest lift that is detectable in 4 weeks at the current volume", () => {
    const g = guideSampleSize({ baselineRate: 0.05, mde: 0.1, mdeKind: "relative", visitorsPerDay: 100, arms: 2 });
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.detectableIn28Days).not.toBeNull();
      expect(g.detectableIn28Days!.relative).toBeGreaterThan(0.1);
    }
  });

  it("without a volume figure gives no duration and does not invent one", () => {
    const g = guideSampleSize({ baselineRate: 0.05, mde: 0.1, mdeKind: "relative" });
    expect(g.ok && g.days).toBeNull();
  });
});

describe("validateExperiment", () => {
  const base = { name: "Hook test", hypothesis: "A question hook raises lead-to-funded rate", metric: "funded_rate", mde: 0.2, mdeKind: "relative" as const, startAt: "2026-10-01", endAt: null, status: "RUNNING" as const, decision: null, learning: null, campaignIds: ["c1"] };
  it("accepts a running experiment without an end", () => {
    expect(validateExperiment(base)).toEqual({ ok: true });
  });
  it("needs a hypothesis and a metric", () => {
    expect(validateExperiment({ ...base, hypothesis: " " })).toMatchObject({ ok: false });
    expect(validateExperiment({ ...base, metric: "" })).toMatchObject({ ok: false });
  });
  it("end cannot be before start", () => {
    expect(validateExperiment({ ...base, endAt: "2026-09-30" })).toMatchObject({ ok: false });
  });
  it("a decided experiment needs a decision, a learning and an end date", () => {
    expect(validateExperiment({ ...base, status: "DECIDED" })).toMatchObject({ ok: false });
    expect(validateExperiment({ ...base, status: "DECIDED", endAt: "2026-10-20", decision: "ADOPT", learning: "Questions won on funded rate." })).toEqual({ ok: true });
  });
});

describe("planDecision", () => {
  it("does not call a winner on thin data", () => {
    const r = planDecision({ a: { visitors: 120, conversions: 6 }, b: { visitors: 118, conversions: 9 } });
    expect(r.verdict).toBe("inconclusive");
    expect(r.message).toMatch(/not enough/i);
  });
  it("reports a clear difference when the sample is large", () => {
    const r = planDecision({ a: { visitors: 5000, conversions: 250 }, b: { visitors: 5000, conversions: 350 } });
    expect(r.verdict).toBe("b_better");
  });
  it("calls a flat result no difference detected, not a tie proven", () => {
    const r = planDecision({ a: { visitors: 5000, conversions: 250 }, b: { visitors: 5000, conversions: 252 } });
    expect(r.verdict).toBe("no_difference_detected");
  });
});
