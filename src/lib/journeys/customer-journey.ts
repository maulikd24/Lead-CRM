/**
 * Customer journeys, the pure half: a named, ordered list of steps that CustomerEvent types complete. Given one customer's events it says which
 * step is done, which is overdue and which is next, and who owns it. No database, no clock other than the `now` passed in, no I/O.
 *
 * Step rule (the only rule the evaluator applies):
 *  - Steps are walked in definition order. A step is done when an event of its type occurs at or after the moment the previous step completed
 *    (the first step: at any time). The earliest such event is the completion time.
 *  - The first step that is not done stops the walk. Every later step is "not started" however its events are timed, so an event that arrives
 *    out of order (a later step's event before an earlier one) never skips a step.
 *  - The stopping step is "overdue" when it has a `maxDaysAfterPrevious` and `now` is past previous completion + that many days; otherwise it is
 *    "not started". The first step has no previous completion, so it is never overdue.
 *  - `next` is the first step that is not done. Nothing here sends or drafts anything: the result is a recommendation (autonomy L2).
 */

export type JourneyOwnerRole = "rm" | "ops" | "compliance";

export type JourneyStepDef = {
  id: string;
  label: string;
  /** The CustomerEvent type (taxonomy name, see src/lib/events/registry.ts) that completes this step. */
  eventType: string;
  ownerRole: JourneyOwnerRole;
  /** Overdue when still open this many days after the previous step completed. Absent: this step is never overdue. */
  maxDaysAfterPrevious?: number;
};

export type JourneyDef = { id: string; name: string; steps: readonly JourneyStepDef[] };

export type JourneyEventFact = { eventType: string; occurredAt: Date };

export type StepStatus = "not_started" | "done" | "overdue";

export type StepEvaluation = {
  stepId: string;
  label: string;
  ownerRole: JourneyOwnerRole;
  status: StepStatus;
  /** ISO time the step completed, or null when not done. */
  completedAt: string | null;
  /** ISO time after which the step is overdue, or null when no deadline applies. */
  dueAt: string | null;
};

export type JourneyEvaluation = {
  journeyId: string;
  steps: StepEvaluation[];
  /** The first step that is not done (a recommendation only), or null when the journey is complete. */
  next: { stepId: string; label: string; ownerRole: JourneyOwnerRole; status: StepStatus } | null;
  complete: boolean;
};

const DAY_MS = 24 * 3_600_000;

/** Earliest event of `eventType` at or after `after` (any time when `after` is null). Ties resolve to the same instant, so the result is deterministic. */
function earliestMatch(events: readonly JourneyEventFact[], eventType: string, after: Date | null): Date | null {
  let best: Date | null = null;
  for (const e of events) {
    if (e.eventType !== eventType) continue;
    const t = e.occurredAt.getTime();
    if (Number.isNaN(t)) continue;
    if (after && t < after.getTime()) continue;
    if (!best || t < best.getTime()) best = new Date(t);
  }
  return best;
}

export function evaluateJourney(def: JourneyDef, events: readonly JourneyEventFact[], now: Date): JourneyEvaluation {
  const steps: StepEvaluation[] = [];
  let previous: Date | null = null;
  let blocked = false;

  for (const step of def.steps) {
    const base = { stepId: step.id, label: step.label, ownerRole: step.ownerRole };
    if (blocked) {
      steps.push({ ...base, status: "not_started", completedAt: null, dueAt: null });
      continue;
    }
    const done = earliestMatch(events, step.eventType, previous);
    if (done) {
      steps.push({ ...base, status: "done", completedAt: done.toISOString(), dueAt: null });
      previous = done;
      continue;
    }
    blocked = true;
    const dueAt = previous && step.maxDaysAfterPrevious !== undefined ? new Date(previous.getTime() + step.maxDaysAfterPrevious * DAY_MS) : null;
    const overdue = dueAt !== null && now.getTime() > dueAt.getTime();
    steps.push({ ...base, status: overdue ? "overdue" : "not_started", completedAt: null, dueAt: dueAt ? dueAt.toISOString() : null });
  }

  const open = steps.find((s) => s.status !== "done");
  const next = open ? { stepId: open.stepId, label: open.label, ownerRole: open.ownerRole, status: open.status } : null;
  return { journeyId: def.id, steps, next, complete: next === null };
}

/**
 * The first journey shipped with the feature. It uses only event types that the platform already emits (see docs/events.md and the producers).
 * "First investment" is any recorded transaction after KYC is verified; the definition does not distinguish the transaction kind.
 */
export const FIRST_INVESTMENT_JOURNEY: JourneyDef = {
  id: "first-investment",
  name: "KYC to first investment",
  steps: [
    { id: "kyc-started", label: "KYC started", eventType: "account.kyc.started", ownerRole: "rm" },
    { id: "kyc-verified", label: "KYC verified", eventType: "account.kyc.verified", ownerRole: "ops", maxDaysAfterPrevious: 14 },
    { id: "first-investment", label: "First investment", eventType: "transaction.recorded", ownerRole: "rm", maxDaysAfterPrevious: 30 },
  ],
};
