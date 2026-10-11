import { can } from "@/lib/access/policy";
import { AD_FORMATS, variantText } from "@/lib/creative/formats";
import type { VariantRow } from "@/lib/creative/service";
import type { VariantAction } from "@/lib/creative/variant-workflow";
import { failedChecks } from "@/lib/guardrails";

import type { Actor, ApprovalAdapter, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { clip, failure, personOf } from "./shared";

/**
 * Ad creative (review of one channel variant of a brief). The legacy path is the creative service's `transition` (the compliance check is re-run on the
 * text as it is now, the author may not approve their own copy when the approval settings say so, compare-and-set on the status). Approve = "approve",
 * reject = "request_changes" with the note. Nothing is ever published or placed: an approved variant is a recorded intent, exported for the firm's own
 * ad-approval annexure.
 */
export type CreativeApprovalRow = VariantRow & { briefTitle: string; submittedAt: Date; authorName: string | null; /** The approval setting: whether the author may approve their own copy. */ fourEyes: boolean };

export type CreativeAdapterDeps = {
  service: { transition(id: string, action: Exclude<VariantAction, "edit">, actor: { id: string; role: string }, opts?: { confirmed?: boolean; note?: string }): Promise<{ ok: true } | { ok: false; error: string }> };
  loadAwaiting: (limit: number) => Promise<CreativeApprovalRow[]>;
  loadRequestedBy: (userId: string, limit: number) => Promise<CreativeApprovalRow[]>;
  loadRow: (id: string) => Promise<CreativeApprovalRow | null>;
};

/** undefined = this variant is not in an approval (a draft nobody has submitted). */
export function toCanonicalAdCreative(row: CreativeApprovalRow): CanonicalApproval | undefined {
  const state = row.status === "NEEDS_REVIEW" ? "requested" : row.status === "APPROVED" ? "approved" : row.reviewNote ? "rejected" : null;
  if (!state) return undefined;
  const format = AD_FORMATS[row.format]?.label ?? row.format;
  const failing = failedChecks({ status: "FAIL", checks: row.complianceChecks });
  const label = row.briefTitle?.trim() || "Ad copy";
  return {
    ref: refOf("ad-creative", row.id), kind: "ad-creative", id: row.id,
    subject: { type: "Creative", id: row.id, label, href: "/marketing?tab=briefs" },
    state, legacyState: row.status,
    summary: `${row.source === "AI" ? "AI draft" : "Ad copy"} for ${format}: ${label}`,
    requestedBy: personOf(row.authorId, row.authorName), requestedAt: row.submittedAt,
    approver: personOf(row.approvedById), decidedAt: row.approvedAt, decisionReason: state === "rejected" ? row.reviewNote : null,
    expiresAt: null,
    evidence: [
      { key: "creative", label: "Ad copy", value: clip(variantText(row.format, row.fields, row.disclaimer), 4000) },
      { key: "compliance", label: "Compliance check", value: failing.length ? failing.map((c) => c.label).join("; ") : row.complianceStatus === "PASS" ? "All rules pass" : "Not checked yet" },
      { key: "channel", label: "Channel", value: format },
      { key: "source", label: "Written by", value: row.source === "AI" ? "AI draft" : "Staff" },
    ],
    correlationId: defaultCorrelation("ad-creative", row.id), causationId: null, autonomy: "L3",
    // An AI draft has no human author, so the person who asked for it may approve it; an Admin can also switch four eyes off for a one-person team.
    fourEyesAuthorId: row.source === "AI" || !row.fourEyes ? null : row.authorId,
    clientId: null,
  };
}

const RULES = [
  [/second pair of eyes/i, "SELF_APPROVAL"], [/needs a variant in|changed this variant first/i, "ALREADY_DECIDED"], [/rules fail|compliance/i, "BLOCKED"],
  [/Only an Admin or the marketing team/i, "FORBIDDEN"], [/no longer exists/i, "NOT_FOUND"], [/Tick the box/i, "NEEDS_INPUT"], [/Say what needs to change/i, "REASON_REQUIRED"],
] as const;

export function createAdCreativeAdapter(deps: CreativeAdapterDeps): ApprovalAdapter {
  const views = (rows: CreativeApprovalRow[]) => rows.map((r) => toCanonicalAdCreative(r)).filter((v): v is CanonicalApproval => !!v);
  const allowed = (actor: Actor) => can(actor.role, "marketing-creative", "manage");
  return {
    kind: "ad-creative",
    async listAwaiting(actor, _now, limit) {
      return allowed(actor) ? views(await deps.loadAwaiting(limit)).filter((v) => v.state === "requested") : [];
    },
    async listRequestedBy(actor, _now, limit) {
      return allowed(actor) ? views(await deps.loadRequestedBy(actor.id, limit)) : [];
    },
    async get(id, actor) {
      if (!allowed(actor)) return null;
      const row = await deps.loadRow(id);
      return row ? (toCanonicalAdCreative(row) ?? null) : null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      const actor = { id: input.actor.id, role: input.actor.role as string };
      const res = input.decision === "approve" ? await deps.service.transition(input.subjectId, "approve", actor, { confirmed: input.params.confirmed === true }) : await deps.service.transition(input.subjectId, "request_changes", actor, { note: input.reason ?? "" });
      return res.ok ? { ok: true } : failure(res.error, RULES);
    },
  };
}
