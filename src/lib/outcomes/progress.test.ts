import { describe, expect, it } from "vitest";

import { monthsBetween, requiredMonthlyContribution, futureValue, computeGoalProgress, DEFAULT_ASSUMPTIONS } from "./progress";

const asOf = new Date("2026-01-01T00:00:00Z");

describe("monthsBetween", () => {
  it("counts whole months, rounding a started month up", () => {
    expect(monthsBetween(asOf, new Date("2027-01-01T00:00:00Z"))).toBe(12);
    expect(monthsBetween(asOf, new Date("2027-01-15T00:00:00Z"))).toBe(13);
  });
  it("is zero for today or the past", () => {
    expect(monthsBetween(asOf, asOf)).toBe(0);
    expect(monthsBetween(asOf, new Date("2025-06-01T00:00:00Z"))).toBe(0);
  });
});

describe("futureValue", () => {
  it("grows a lump sum at the assumed rate (effective annual, compounded monthly)", () => {
    expect(futureValue({ present: 100_000, monthly: 0, annualRatePct: 12, months: 12 })).toBeCloseTo(112_000, 0);
  });
  it("with a zero rate it is simple addition", () => {
    expect(futureValue({ present: 1000, monthly: 100, annualRatePct: 0, months: 10 })).toBe(2000);
  });
  it("adds end-of-month contributions", () => {
    const v = futureValue({ present: 0, monthly: 10_000, annualRatePct: 12, months: 12 });
    // monthly rate = 1.12^(1/12)-1 ; annuity factor
    const r = 1.12 ** (1 / 12) - 1;
    expect(v).toBeCloseTo(10_000 * ((1 + r) ** 12 - 1) / r, 4);
  });
});

describe("requiredMonthlyContribution", () => {
  it("is zero when the current value already reaches the target at the assumed rate", () => {
    expect(requiredMonthlyContribution({ target: 100_000, present: 100_000, annualRatePct: 8, months: 24 })).toBe(0);
  });
  it("round-trips with futureValue", () => {
    const pmt = requiredMonthlyContribution({ target: 5_000_000, present: 500_000, annualRatePct: 9, months: 120 });
    expect(pmt).not.toBeNull();
    expect(futureValue({ present: 500_000, monthly: pmt!, annualRatePct: 9, months: 120 })).toBeCloseTo(5_000_000, 0);
  });
  it("with a zero rate divides the gap evenly", () => {
    expect(requiredMonthlyContribution({ target: 120_000, present: 0, annualRatePct: 0, months: 12 })).toBe(10_000);
  });
  it("is null when no months are left and the target is not met", () => {
    expect(requiredMonthlyContribution({ target: 100, present: 10, annualRatePct: 8, months: 0 })).toBeNull();
  });
});

describe("computeGoalProgress", () => {
  const base = { targetAmount: 1_000_000, targetDate: new Date("2036-01-01T00:00:00Z"), currentValue: 200_000, plannedMonthly: null, annualRatePct: null, asOf };

  it("uses the default assumed rate when none is set and says so", () => {
    const p = computeGoalProgress(base);
    expect(p.assumptions.annualRatePct).toBe(DEFAULT_ASSUMPTIONS.annualRatePct);
    expect(p.assumptions.rateIsDefault).toBe(true);
    expect(p.assumptions.months).toBe(120);
  });

  it("reports share of the target held today", () => {
    expect(computeGoalProgress(base).progressPct).toBe(20);
  });

  it("is achieved when the linked holdings already cover the target", () => {
    const p = computeGoalProgress({ ...base, currentValue: 1_200_000 });
    expect(p.status).toBe("achieved");
    expect(p.requiredMonthly).toBe(0);
  });

  it("is behind when holdings plus the stated contribution fall short at the assumed rate", () => {
    const p = computeGoalProgress({ ...base, plannedMonthly: 1000, annualRatePct: 8 });
    expect(p.status).toBe("behind");
    expect(p.requiredMonthly!).toBeGreaterThan(1000);
    expect(p.shortfallAtAssumed!).toBeGreaterThan(0);
  });

  it("is on track when the projection is within the tolerance of the target", () => {
    const need = computeGoalProgress({ ...base, annualRatePct: 8 }).requiredMonthly!;
    const p = computeGoalProgress({ ...base, plannedMonthly: need, annualRatePct: 8 });
    expect(p.status).toBe("on_track");
  });

  it("is ahead when the projection clears the target by the ahead margin", () => {
    const need = computeGoalProgress({ ...base, annualRatePct: 8 }).requiredMonthly!;
    const p = computeGoalProgress({ ...base, plannedMonthly: need * 1.5, annualRatePct: 8 });
    expect(p.status).toBe("ahead");
  });

  it("a goal whose date has passed and is not met is behind and has no required contribution", () => {
    const p = computeGoalProgress({ ...base, targetDate: new Date("2025-12-01T00:00:00Z") });
    expect(p.status).toBe("behind");
    expect(p.requiredMonthly).toBeNull();
    expect(p.assumptions.months).toBe(0);
  });

  it("shows the lower-rate case so the sensitivity is visible", () => {
    const p = computeGoalProgress({ ...base, annualRatePct: 8 });
    expect(p.requiredMonthlyLowerRate!).toBeGreaterThan(p.requiredMonthly!);
    expect(p.assumptions.lowerRatePct).toBe(6);
  });

  it("never lets an assumed rate outside the allowed range through", () => {
    expect(computeGoalProgress({ ...base, annualRatePct: 80 }).assumptions.annualRatePct).toBe(DEFAULT_ASSUMPTIONS.maxRatePct);
    expect(computeGoalProgress({ ...base, annualRatePct: -5 }).assumptions.annualRatePct).toBe(DEFAULT_ASSUMPTIONS.minRatePct);
  });

  it("is deterministic and pure: the same input gives the same output", () => {
    expect(computeGoalProgress(base)).toEqual(computeGoalProgress(base));
  });
});
