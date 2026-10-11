import { canAccessMarketing } from "@/lib/access/marketing-access";
import type { ChecklistItem, PlanStatus } from "@/lib/planner/workflow";

import type { Actor, ApprovalAdapter, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { clip, failure, personOf } from "./shared";

/**
 * Campaign plans (four-eyes review). The legacy path is the planner's `transitionPlan` (compare-and-set on the status, the checklist re-run at
 * the gate, the person who drafted the plan may not approve it, an unregistered creator or an unapproved product claim blocks it). Approve =
 * "approve" with the reader's tick, reject = "request_changes" with the note. Nothing is ever published or sent: an approved plan is a recorded
 * intent and scheduling records dates only.
 */
export type PlanApprovalRow = {
  id: string;
  code: string;
  title: string;
  status: PlanStatus;
  channelLabel: string;
  audienceName: string;
  promiseHook: string;
  destinationName: string;
  destinationStatus: string;
  checklist: ChecklistItem[];
  createdById: string;
  authorName: string | null;
  submittedAt: Date;
  approvedById: string | null;
  approvedAt: Date | null;
  /** The note of the last "request changes" decision while the plan is back in draft. */
  reviewNote: string | null;
  budgetInr: number | null;
  startDate: string | null;
  endDate: string | null;
};

export type PlannerAdapterDeps = {
  service: { transition(id: string, action: "approve" | "request_changes", input: { actor: { id: string; role: string }; confirmed?: boolean; note?: string }): Promise<{ ok: true } | { ok: false; error: string }> };
  loadAwaiting: (limit: number) => Promise<PlanApprovalRow[]>;
  loadRequestedBy: (userId: string, limit: number) => Promise<PlanApprovalRow[]>;
  loadRow: (id: string) => Promise<PlanApprovalRow | null>;
};

const money = (n: number | null) => (n == null ? "not set" : `INR ${new Intl.NumberFormat("en-IN").format(n)}`);

/** undefined = this plan is not in an approval (a draft nobody has sent for review). */
export function toCanonicalPlannerPlan(row: PlanApprovalRow): CanonicalApproval | undefined {
  const state = row.status === "NEEDS_REVIEW" ? "requested" : row.status === "APPROVED" || row.status === "SCHEDULED" ? "approved" : row.reviewNote ? "rejected" : null;
  if (!state) return undefined;
  const failing = row.checklist.filter((i) => i.status === "fail");
  const dates = row.startDate ? `${row.startDate}${row.endDate ? ` to ${row.endDate}` : ""}` : "no dates yet";
  return {
    ref: refOf("planner-plan", row.id), kind: "planner-plan", id: row.id,
    subject: { type: "Campaign plan", id: row.id, label: row.title, href: `/planner/${row.id}` },
    state, legacyState: row.status,
    summary: `${row.channelLabel} plan for ${row.audienceName}: ${row.title}`,
    requestedBy: personOf(row.createdById, row.authorName), requestedAt: row.submittedAt,
    approver: personOf(row.approvedById), decidedAt: row.approvedAt, decisionReason: state === "rejected" ? row.reviewNote : null,
    expiresAt: null,
    evidence: [
      { key: "plan", label: "Plan", value: clip(`${row.code}: ${row.promiseHook}. Audience ${row.audienceName}, channel ${row.channelLabel}, lands on ${row.destinationName} (${row.destinationStatus.toLowerCase()}). Budget ${money(row.budgetInr)}, ${dates}.`, 1500) },
      { key: "checklist", label: "Pre-approval checklist", value: failing.length ? `Failing: ${failing.map((i) => i.label).join("; ")}` : `All ${row.checklist.length} items pass` },
      { key: "channel", label: "Channel", value: row.channelLabel },
    ],
    correlationId: defaultCorrelation("planner-plan", row.id), causationId: null, autonomy: "L3",
    fourEyesAuthorId: row.createdById, clientId: null,
  };
}

const RULES = [
  [/A different person must approve/i, "SELF_APPROVAL"], [/Someone else changed|Only a plan that is/i, "ALREADY_DECIDED"], [/Cannot approve yet|Cannot send for review/i, "BLOCKED"],
  [/no longer exists/i, "NOT_FOUND"], [/Tick the box/i, "NEEDS_INPUT"], [/Say what needs to change/i, "REASON_REQUIRED"],
] as const;

export function createPlannerPlanAdapter(deps: PlannerAdapterDeps): ApprovalAdapter {
  const views = (rows: PlanApprovalRow[]) => rows.map((r) => toCanonicalPlannerPlan(r)).filter((v): v is CanonicalApproval => !!v);
  const allowed = (actor: Actor) => canAccessMarketing(actor.role);
  return {
    kind: "planner-plan",
    async listAwaiting(actor, _now, limit) {
      return allowed(actor) ? views(await deps.loadAwaiting(limit)).filter((v) => v.state === "requested") : [];
    },
    async listRequestedBy(actor, _now, limit) {
      return allowed(actor) ? views(await deps.loadRequestedBy(actor.id, limit)) : [];
    },
    async get(id, actor) {
      if (!allowed(actor)) return null;
      const row = await deps.loadRow(id);
      return row ? (toCanonicalPlannerPlan(row) ?? null) : null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      const actor = { id: input.actor.id, role: input.actor.role as string };
      const res = input.decision === "approve" ? await deps.service.transition(input.subjectId, "approve", { actor, confirmed: input.params.confirmed === true }) : await deps.service.transition(input.subjectId, "request_changes", { actor, note: input.reason ?? "" });
      return res.ok ? { ok: true } : failure(res.error, RULES);
    },
  };
}
