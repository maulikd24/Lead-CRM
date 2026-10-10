/**
 * The fixed numbers behind the cadence, the rules and the attention score. One object so the owner can read and
 * change every threshold in one place; the engines take it as a parameter so tests can vary it. These are defaults
 * pending the owner's confirmation (see the report).
 */
export const OUTCOME_CONFIG = {
  /** Review cadence by tier of current holdings value. A customer with no holdings has no review cadence. */
  tiers: [
    { key: "A", label: "Tier A", minAum: 10_000_000, reviewEveryDays: 90 },
    { key: "B", label: "Tier B", minAum: 2_500_000, reviewEveryDays: 180 },
    { key: "C", label: "Tier C", minAum: 1, reviewEveryDays: 365 },
  ],
  rules: {
    /** Idle cash estimate at or above this amount, and at least this share of cash plus holdings. */
    idleCashMin: 100_000,
    idleCashShare: 0.1,
    /** Concentration: the largest asset class at or above this share, with at least this much in holdings. */
    concentrationTopPct: 70,
    concentrationMinAum: 500_000,
    /** A goal target date this close (days) is a key date. */
    goalDateWithinDays: 180,
    /** A promise due within this many days (or overdue) is a key date. */
    commitmentWithinDays: 14,
    /** Default snooze when a suggestion is dismissed. */
    dismissSnoozeDays: 30,
  },
  /** The attention score: weights sum to 100. Each signal is scaled 0 to 1, then multiplied by its weight. */
  risk: {
    weights: { contactGap: 25, reviewOverdue: 20, serviceSignals: 15, dormancy: 10, valueFall: 10, goalsBehind: 10, consentWithdrawn: 5, kycGap: 5 },
    /** Days without contact: 0 points up to `from`, full weight at `to`, linear between. */
    contactGapDays: { from: 30, to: 120 },
    /** Days since the last transaction while holding assets. */
    dormancyDays: { from: 90, to: 365 },
    /** Fall in holdings value over about 90 days, in percent: 0 points up to `from`, full at `to`. */
    valueFallPct: { from: 5, to: 30 },
    bands: { high: 60, medium: 30 },
  },
} as const;

export type OutcomeConfig = typeof OUTCOME_CONFIG;
