import { DENY_REASONS } from "@/lib/autopilot/recommendations";
import type { ApprovalAdapter, Actor, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { effectiveState, type CanonicalState } from "../state";
import { clip, failure, personOf, states } from "./shared";

/**
 * Autopilot action (a proposed change to an ad account: pause, trim a budget, add negatives, exclude placements, adjust a schedule). The legacy path is
 * lib/autopilot/decisions.ts and stays the ONLY code that records a decision (a compare-and-set on the proposal row) and, in a second explicit human act,
 * applies it. The canonical service decides who may approve, four-eyes (optional per Settings), the reason, the expiry and the audit row, then calls it unchanged.
 * Autonomy is L4: a person approves each action; the apply step is blocked by default and nothing applies on approval.
 */
export type ActionRow = {
  id: string; ruleKey: string; category: string; severity: string; issue: string; evidence: string[];
  actionKind: string; actionSummary: string; impactAmount: number | null; impactText: string; confidence: string; appliable: boolean;
  status: "PENDING" | "APPROVED" | "DENIED" | "APPLYING" | "APPLIED" | "FAILED" | "UNDONE" | "EXPIRED";
  decidedById: string | null; decidedAt: Date | null; decisionNote: string | null; appliedAt: Date | null; lastError: string | null;
  firstSeenAt: Date; expiresAt: Date | null; correlationId: string | null;
  /** The person who wrote the rule this proposal came from; null for the built-in audit controls. */
  ruleAuthorId: string | null;
};

export type AutopilotAdapterDeps = {
  loadAwaiting: (limit: number) => Promise<ActionRow[]>;
  loadRow: (id: string) => Promise<ActionRow | null>;
  /** The Settings switch: when on, a proposal from a rule cannot be approved by the person who wrote the rule. */
  requireSecondApprover: () => Promise<boolean>;
  /** The legacy decision path (decideRecommendation). */
  decide: (input: { recId: string; verdict: "approve" | "deny"; actorId: string; reasonCode?: string; note?: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  expire: (id: string) => Promise<void>;
};

const STATE: Record<ActionRow["status"], CanonicalState> = { PENDING: "requested", APPROVED: "approved", APPLYING: "approved", APPLIED: "executed", DENIED: "rejected", FAILED: "failed", UNDONE: "cancelled", EXPIRED: "expired" };

/** Marketing and Admin only: the same rule as the Autopilot screens (area marketing-autopilot). */
const mayAct = (actor: Pick<Actor, "role">) => actor.role === "ADMIN" || actor.role === "MARKETING";

const KIND_LABEL: Record<string, string> = {
  pause_campaign: "Pause a campaign", reduce_budget: "Reduce a budget", add_negative_keywords: "Add negative keywords", exclude_placement: "Exclude placements", adjust_schedule: "Adjust the schedule",
  fix_tracking: "Fix tracking", staff_shift: "Change staffing", refresh_creative: "Refresh creative", review_manually: "Review manually",
};

export function toCanonicalAutopilotAction(row: ActionRow, now: Date, secondApprover: boolean): CanonicalApproval {
  return {
    ref: refOf("autopilot-action", row.id), kind: "autopilot-action", id: row.id,
    subject: { type: "Ad recommendation", id: row.id, label: clip(row.actionSummary, 120), href: "/autopilot?tab=actions" },
    state: effectiveState(states(STATE, row.status), row.expiresAt, now),
    legacyState: row.status,
    summary: `${KIND_LABEL[row.actionKind] ?? "Ad action"}: ${clip(row.issue, 160)}`,
    requestedBy: null, requestedAt: row.firstSeenAt,
    approver: personOf(row.decidedById), decidedAt: row.decidedAt, decisionReason: row.decisionNote ?? row.lastError,
    expiresAt: row.expiresAt,
    evidence: [
      { key: "issue", label: "Issue", value: clip(row.issue, 400) },
      { key: "impact", label: "What it could change", value: clip(row.impactText || "Not estimated: no honest figure is available.", 300) },
      { key: "action", label: "Proposed action", value: clip(row.actionSummary, 300) },
      { key: "confidence", label: "Confidence", value: `${row.confidence} (${row.severity} severity)` },
      ...row.evidence.slice(0, 5).map((e, i) => ({ key: `evidence${i + 1}`, label: `Evidence ${i + 1}`, value: clip(e, 200) })),
    ],
    correlationId: row.correlationId ?? defaultCorrelation("autopilot-action", row.id), causationId: null, autonomy: "L4",
    fourEyesAuthorId: secondApprover ? row.ruleAuthorId : null, clientId: null,
  };
}

const RULES = [[/already/i, "ALREADY_DECIDED"], [/no longer exists/i, "NOT_FOUND"], [/reason|say briefly/i, "REASON_REQUIRED"], [/must make the decision|person/i, "NOT_HUMAN"]] as const;

export function createAutopilotActionAdapter(deps: AutopilotAdapterDeps): ApprovalAdapter {
  return {
    kind: "autopilot-action",
    async listAwaiting(actor, now, limit) {
      if (!mayAct(actor)) return [];
      const second = await deps.requireSecondApprover();
      return (await deps.loadAwaiting(limit)).map((r) => toCanonicalAutopilotAction(r, now, second));
    },
    async listRequestedBy() {
      return [];
    },
    async get(id, actor, now) {
      if (!mayAct(actor)) return null;
      const row = await deps.loadRow(id);
      return row ? toCanonicalAutopilotAction(row, now, await deps.requireSecondApprover()) : null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      const verdict = input.decision === "approve" ? "approve" : "deny";
      const code = typeof input.params.reasonCode === "string" && DENY_REASONS.some((r) => r.code === input.params.reasonCode) ? (input.params.reasonCode as string) : "other";
      const res = await deps.decide({ recId: input.subjectId, verdict, actorId: input.actor.id, ...(verdict === "deny" ? { reasonCode: code, note: input.reason ?? "" } : {}) });
      return res.ok ? { ok: true } : failure(res.error, RULES);
    },
    async expire(id) {
      await deps.expire(id).catch(() => undefined);
    },
  };
}
