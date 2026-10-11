// DecisionOutcome linking: later events that happened to a customer after a decision. CORRELATION IS NOT CAUSATION: a contact or a
// funding after a recommendation says nothing about whether the recommendation caused it (RM skill and customer choice confound it).
import { DAY_MS, ENGINE_CONFIG } from "./constants";

export const CORRELATION_NOTE = "Shown next to the decision, not caused by it: correlation is not causation. RM skill and the customer's own choices drive these results.";

export const OUTCOME_KINDS = ["contact", "response", "interaction_outcome", "kyc", "funding", "complaint_resolved"] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

export type LaterEvent = { kind: OutcomeKind; ref: string; at: Date; assetClass?: string | null; detail?: string | null };
export type DecisionForLinking = { id: string; clientId: string; createdAt: Date; assetClass: string | null; result: string };
export type OutcomeDraft = { decisionId: string; clientId: string; kind: OutcomeKind; eventRef: string; occurredAt: Date; daysAfter: number; detail: string | null };

const WINDOW_DAYS: Record<OutcomeKind, number> = {
  contact: ENGINE_CONFIG.outcomeWindowDays,
  response: ENGINE_CONFIG.outcomeWindowDays,
  interaction_outcome: ENGINE_CONFIG.outcomeWindowDays,
  kyc: 30,
  funding: 30,
  complaint_resolved: 30,
};

export function linkOutcomes(decision: DecisionForLinking, events: LaterEvent[]): OutcomeDraft[] {
  if (decision.result === "ABSTAIN") return [];
  const out: OutcomeDraft[] = [];
  for (const e of events) {
    const after = e.at.getTime() - decision.createdAt.getTime();
    if (after < 0 || after > WINDOW_DAYS[e.kind] * DAY_MS) continue;
    // A conversation outcome about a different asset class is not about this decision.
    if (e.kind === "interaction_outcome" && e.assetClass && decision.assetClass && e.assetClass !== decision.assetClass) continue;
    out.push({ decisionId: decision.id, clientId: decision.clientId, kind: e.kind, eventRef: e.ref, occurredAt: e.at, daysAfter: Math.floor(after / DAY_MS), detail: e.detail ?? null });
  }
  return out;
}

export type Followed = { decisionId: string; feedback: string | null; outcomeKinds: OutcomeKind[] };

/** Contact and response rates after Accept versus after Ignored or Expired. Counts, not causes. */
export function outcomeRates(rows: Followed[]) {
  const group = (pred: (f: string | null) => boolean) => {
    const g = rows.filter((r) => pred(r.feedback));
    const withContact = g.filter((r) => r.outcomeKinds.includes("contact") || r.outcomeKinds.includes("interaction_outcome")).length;
    const withResponse = g.filter((r) => r.outcomeKinds.includes("response")).length;
    return { decisions: g.length, followedByContact: withContact, followedByResponse: withResponse };
  };
  return {
    afterAccept: group((f) => f === "accept" || f === "done"),
    afterIgnored: group((f) => f === null || f === "ignored" || f === "expired"),
    note: CORRELATION_NOTE,
  };
}
