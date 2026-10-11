// Retention for shadow decisions (proposed default from the Wave 2 decision report, now implemented): a decision nobody reviewed is kept 180 days, a
// reviewed one (a person gave feedback) 24 months, because reviewed decisions are the evaluation data. Pure rules here; retention-db.ts runs them.
import { DAY_MS } from "./constants";

export const DECISION_RETENTION = { unreviewedDays: 180, reviewedDays: 730, batch: 500 } as const;

export function decisionRetentionCutoffs(now: Date): { unreviewedBefore: Date; reviewedBefore: Date } {
  return { unreviewedBefore: new Date(now.getTime() - DECISION_RETENTION.unreviewedDays * DAY_MS), reviewedBefore: new Date(now.getTime() - DECISION_RETENTION.reviewedDays * DAY_MS) };
}

/** `humanFeedbackCount` counts feedback by a person; the system's own "expired" row does not make a decision reviewed. */
export function isDecisionDueForDeletion(d: { createdAt: Date; humanFeedbackCount: number }, now: Date): boolean {
  const c = decisionRetentionCutoffs(now);
  return d.createdAt.getTime() < (d.humanFeedbackCount > 0 ? c.reviewedBefore : c.unreviewedBefore).getTime();
}
