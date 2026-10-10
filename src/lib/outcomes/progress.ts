/**
 * Goal progress arithmetic. Pure functions only: no database, no clock, no randomness.
 *
 * Everything here is ILLUSTRATIVE ARITHMETIC on assumptions the user can see and change. It is not a forecast, a
 * return prediction or advice: the "assumed rate" is a number typed in (or a configurable default), never a
 * statement about what an investment will do. The result always travels with its assumptions (`assumptions`).
 */

export const DEFAULT_ASSUMPTIONS = {
  /** Assumed growth rate per year used when a goal has none of its own. Deliberately modest; owner to confirm. */
  annualRatePct: 8,
  minRatePct: 0,
  maxRatePct: 20,
  /** The lower-rate sensitivity case is this many percentage points below the assumed rate (never below the minimum). */
  lowerRateGapPct: 2,
  /** Projection at or above this share of the target counts as on track. */
  onTrackShare: 0.95,
  /** Projection at or above this share of the target counts as ahead. */
  aheadShare: 1.1,
} as const;

export type GoalStatusLabel = "achieved" | "ahead" | "on_track" | "behind";

/** Whole months from `from` to `to`, a started month counting as a month. Zero for a date that is not in the future. */
export function monthsBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  // Compare the day-of-month (and time) of the end point against the start's to see whether a month has only started.
  const anchor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + months, from.getUTCDate(), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds()));
  if (anchor.getTime() < to.getTime()) months += 1;
  return Math.max(0, months);
}

/** Effective monthly rate for an annual rate in percent (annual compounding equivalent). */
const monthlyRate = (annualRatePct: number) => (1 + annualRatePct / 100) ** (1 / 12) - 1;

/** Value after `months` of growth at the assumed rate, with `monthly` added at the end of each month. */
export function futureValue(input: { present: number; monthly: number; annualRatePct: number; months: number }): number {
  const { present, monthly, annualRatePct, months } = input;
  if (months <= 0) return present;
  const r = monthlyRate(annualRatePct);
  if (r === 0) return present + monthly * months;
  const growth = (1 + r) ** months;
  return present * growth + (monthly * (growth - 1)) / r;
}

/** The monthly amount that would close the gap at the assumed rate. Zero when already covered; null when no time is left. */
export function requiredMonthlyContribution(input: { target: number; present: number; annualRatePct: number; months: number }): number | null {
  const { target, present, annualRatePct, months } = input;
  const alone = futureValue({ present, monthly: 0, annualRatePct, months });
  if (alone >= target) return 0;
  if (months <= 0) return null;
  const r = monthlyRate(annualRatePct);
  const gap = target - alone;
  return r === 0 ? gap / months : (gap * r) / ((1 + r) ** months - 1);
}

export type GoalProgressInput = {
  targetAmount: number;
  targetDate: Date;
  /** Value today of the holdings linked to the goal (from the portfolio feed). */
  currentValue: number;
  /** What the customer says they put towards the goal each month; null when nothing is stated. */
  plannedMonthly: number | null;
  /** Assumed annual rate chosen for this goal; null means the default. */
  annualRatePct: number | null;
  asOf: Date;
};

export type GoalProgress = {
  status: GoalStatusLabel;
  /** Share of the target the linked holdings are worth today, 0 to 100 (capped for display; achieved can be above the target). */
  progressPct: number;
  currentValue: number;
  targetAmount: number;
  /** Monthly contribution that would reach the target at the assumed rate; 0 if already covered, null if the date has passed. */
  requiredMonthly: number | null;
  /** Same figure at the lower assumed rate (the sensitivity case). */
  requiredMonthlyLowerRate: number | null;
  /** What the linked holdings plus the stated monthly amount would be worth at the target date, at the assumed rate. Illustrative. */
  projectedAtAssumed: number;
  /** Target minus the projection at the assumed rate; 0 when the projection reaches the target. */
  shortfallAtAssumed: number;
  assumptions: { annualRatePct: number; rateIsDefault: boolean; lowerRatePct: number; months: number; plannedMonthly: number | null };
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export function computeGoalProgress(input: GoalProgressInput): GoalProgress {
  const rateIsDefault = input.annualRatePct === null;
  const annualRatePct = clamp(input.annualRatePct ?? DEFAULT_ASSUMPTIONS.annualRatePct, DEFAULT_ASSUMPTIONS.minRatePct, DEFAULT_ASSUMPTIONS.maxRatePct);
  const lowerRatePct = Math.max(DEFAULT_ASSUMPTIONS.minRatePct, annualRatePct - DEFAULT_ASSUMPTIONS.lowerRateGapPct);
  const months = monthsBetween(input.asOf, input.targetDate);
  const planned = input.plannedMonthly !== null && input.plannedMonthly > 0 ? input.plannedMonthly : 0;
  const target = input.targetAmount;

  const projected = futureValue({ present: input.currentValue, monthly: planned, annualRatePct, months });
  const required = requiredMonthlyContribution({ target, present: input.currentValue, annualRatePct, months });
  const requiredLower = requiredMonthlyContribution({ target, present: input.currentValue, annualRatePct: lowerRatePct, months });

  const share = target > 0 ? projected / target : 1;
  let status: GoalStatusLabel;
  if (input.currentValue >= target) status = "achieved";
  else if (months === 0) status = "behind";
  else if (share >= DEFAULT_ASSUMPTIONS.aheadShare) status = "ahead";
  else if (share >= DEFAULT_ASSUMPTIONS.onTrackShare) status = "on_track";
  else status = "behind";

  return {
    status,
    progressPct: target > 0 ? Math.round(clamp((input.currentValue / target) * 100, 0, 100) * 10) / 10 : 0,
    currentValue: input.currentValue,
    targetAmount: target,
    requiredMonthly: required === null ? null : round2(required),
    requiredMonthlyLowerRate: requiredLower === null ? null : round2(requiredLower),
    projectedAtAssumed: round2(projected),
    shortfallAtAssumed: round2(Math.max(0, target - projected)),
    assumptions: { annualRatePct, rateIsDefault, lowerRatePct, months, plannedMonthly: input.plannedMonthly },
  };
}
