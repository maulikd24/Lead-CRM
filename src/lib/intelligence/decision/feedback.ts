// Feedback on a decision: Accept, Done, Snooze, Wrong, Not now, Do not recommend. PURE planner: it says what should happen
// (the status, the dismissal that keeps it from coming back, the Task an Accept creates); feedback-db.ts does it.
// Accept creates a Task. It never sends anything and never opens an outbound message.
import { ENGINE_CONFIG } from "./constants";
import { WRONG_REASONS, type DecisionStatus } from "./types";

export const DNR_REASONS = ["customer_asked", "not_suitable", "already_holds", "other"] as const;
export type DnrReason = (typeof DNR_REASONS)[number];

export type UserFeedback =
  | { kind: "accept" }
  | { kind: "done" }
  | { kind: "snooze"; days: number }
  | { kind: "wrong"; reason: string }
  | { kind: "not_now"; until: Date }
  | { kind: "dnr"; reason: string; until?: Date };

export type DecisionSnapshot = { id: string; result: string; action: string; programme: string; topic: string | null; assetClass: string | null; timing: string; chosenRuleKey: string | null; chosenFingerprint: string | null; status: string };

export type FeedbackPlan =
  | {
      ok: true;
      feedback: { kind: string; reason: string | null; until: Date | null; scope: string | null };
      status: DecisionStatus;
      dismissal: { ruleKey: string; fingerprint: string; snoozeUntil: Date; reason: string | null } | null;
      task: { title: string; dueAt: Date; source: string; assignedToId: string } | null;
      /** A do-not-recommend entry for the memory seam (and the visible suppression note). */
      suppression: { scope: string; assetClass: string | null; reason: string | null; until: Date } | null;
    }
  | { ok: false; error: string };

const DAY = 86_400_000;
const WRONG_SNOOZE_DAYS = 7;
const MAX_NOT_NOW_DAYS = 90;
const MAX_DNR_DAYS = 730;
const SALES_PROGRAMMES = ["Demat portfolio transfer", "Mutual fund portfolio transfer", "Portfolio rebalance", "MF / SIP opportunity", "PMS / AIF opportunity", "Broking activation / reactivation", "Tax-planning discussion", "First transaction"];

function dueFor(timing: string, now: Date): Date {
  const days = timing === "Today" ? 0 : timing === "This Week" ? 3 : 7;
  const d = new Date(now.getTime() + days * DAY);
  d.setUTCHours(12, 0, 0, 0);
  return d.getTime() <= now.getTime() ? new Date(now.getTime() + 2 * 3600 * 1000) : d;
}

export function planFeedback(decision: DecisionSnapshot, input: UserFeedback, now: Date, assigneeId: string | null): FeedbackPlan {
  const actionable = decision.result === "RECOMMEND" && decision.action !== "No Action";
  if (!actionable && input.kind !== "wrong") return { ok: false, error: "Only a recommendation can be accepted, snoozed or marked done. You can mark a decision wrong." };
  const dismissalFor = (until: Date, reason: string | null) => (decision.chosenRuleKey && decision.chosenFingerprint ? { ruleKey: decision.chosenRuleKey, fingerprint: decision.chosenFingerprint, snoozeUntil: until, reason } : null);

  switch (input.kind) {
    case "accept": {
      if (!assigneeId) return { ok: false, error: "This customer has no assigned RM to own the task." };
      return {
        ok: true,
        feedback: { kind: "accept", reason: null, until: null, scope: null },
        status: "ACCEPTED",
        dismissal: null,
        task: { title: `${decision.topic ?? decision.programme}`.slice(0, 140), dueAt: dueFor(decision.timing, now), source: `nba:${decision.id}`, assignedToId: assigneeId },
        suppression: null,
      };
    }
    case "done":
      return { ok: true, feedback: { kind: "done", reason: null, until: null, scope: null }, status: "DONE", dismissal: null, task: null, suppression: null };
    case "snooze": {
      if (!(ENGINE_CONFIG.snoozeDays as readonly number[]).includes(input.days)) return { ok: false, error: "Snooze for 1 day, 3 days or 1 week." };
      const until = new Date(now.getTime() + input.days * DAY);
      return { ok: true, feedback: { kind: "snooze", reason: null, until, scope: null }, status: "SNOOZED", dismissal: dismissalFor(until, null), task: null, suppression: null };
    }
    case "not_now": {
      if (!(input.until instanceof Date) || Number.isNaN(input.until.getTime()) || input.until.getTime() <= now.getTime()) return { ok: false, error: "Pick a date in the future." };
      if (input.until.getTime() > now.getTime() + MAX_NOT_NOW_DAYS * DAY) return { ok: false, error: `Not now can last at most ${MAX_NOT_NOW_DAYS} days.` };
      return { ok: true, feedback: { kind: "not_now", reason: null, until: input.until, scope: null }, status: "SNOOZED", dismissal: dismissalFor(input.until, null), task: null, suppression: null };
    }
    case "wrong": {
      if (!(WRONG_REASONS as readonly string[]).includes(input.reason)) return { ok: false, error: "Say what was wrong: the fact, already done, the customer, the channel or the product." };
      const until = new Date(now.getTime() + WRONG_SNOOZE_DAYS * DAY);
      return { ok: true, feedback: { kind: "wrong", reason: input.reason, until: null, scope: null }, status: "DISMISSED", dismissal: actionable ? dismissalFor(until, input.reason) : null, task: null, suppression: null };
    }
    case "dnr": {
      if (!(DNR_REASONS as readonly string[]).includes(input.reason)) return { ok: false, error: "Say why: the customer asked, not suitable, already holds it, or other." };
      const isProduct = !!decision.assetClass || SALES_PROGRAMMES.includes(decision.programme);
      if (!isProduct) return { ok: false, error: "Do not recommend applies to a product or topic, not to a service step." };
      const until = input.until ?? new Date(now.getTime() + ENGINE_CONFIG.dnrDefaultDays * DAY);
      if (until.getTime() <= now.getTime() || until.getTime() > now.getTime() + MAX_DNR_DAYS * DAY) return { ok: false, error: "Pick an expiry between tomorrow and two years from now." };
      const scope = decision.assetClass ?? decision.programme;
      return {
        ok: true,
        feedback: { kind: "dnr", reason: input.reason, until, scope },
        status: "DISMISSED",
        dismissal: { ruleKey: "nba.dnr", fingerprint: `dnr:${scope}`, snoozeUntil: until, reason: input.reason },
        task: null,
        suppression: { scope, assetClass: decision.assetClass, reason: input.reason, until },
      };
    }
  }
}
