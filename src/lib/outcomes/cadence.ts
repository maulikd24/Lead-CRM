import { OUTCOME_CONFIG, type OutcomeConfig } from "./config";

export const DAY_MS = 86_400_000;

export type Tier = { key: string; label: string; reviewEveryDays: number };

/** The tier for a holdings value, or null when there are no holdings (no review cadence). Tiers are listed richest first. */
export function tierFor(aum: number, config: OutcomeConfig = OUTCOME_CONFIG): Tier | null {
  if (!(aum > 0)) return null;
  const tier = config.tiers.find((t) => aum >= t.minAum);
  return tier ? { key: tier.key, label: tier.label, reviewEveryDays: tier.reviewEveryDays } : null;
}

export type ReviewStatus = {
  tier: string | null;
  tierLabel: string | null;
  cadenceDays: number | null;
  overdue: boolean;
  daysOverdue: number;
  neverReviewed: boolean;
  /** When the next review falls due; null without a cadence. */
  dueAt: Date | null;
};

export function reviewStatus(input: { aum: number; lastReviewAt: Date | null; createdAt: Date; now: Date }, config: OutcomeConfig = OUTCOME_CONFIG): ReviewStatus {
  const tier = tierFor(input.aum, config);
  if (!tier) return { tier: null, tierLabel: null, cadenceDays: null, overdue: false, daysOverdue: 0, neverReviewed: input.lastReviewAt === null, dueAt: null };
  const since = input.lastReviewAt ?? input.createdAt;
  const dueAt = new Date(since.getTime() + tier.reviewEveryDays * DAY_MS);
  const daysOverdue = Math.max(0, Math.floor((input.now.getTime() - dueAt.getTime()) / DAY_MS));
  return { tier: tier.key, tierLabel: tier.label, cadenceDays: tier.reviewEveryDays, overdue: input.now.getTime() > dueAt.getTime(), daysOverdue, neverReviewed: input.lastReviewAt === null, dueAt };
}
