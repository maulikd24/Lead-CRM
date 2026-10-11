import { canAccessMarketing } from "@/lib/access/marketing-access";
import { SOCIAL_CHANNELS } from "@/lib/marketing/social/compliance";
import type { ServiceResult } from "@/lib/marketing/social/service";
import type { PostRow } from "@/lib/marketing/social/service";
import type { PostAction } from "@/lib/marketing/social/workflow";

import type { Actor, ApprovalAdapter, CanonicalApproval, DecideInput, LegacyOutcome } from "../contract";
import { defaultCorrelation, refOf } from "../contract";
import { clip, failure, personOf } from "./shared";

/**
 * SocialPost (four-eyes review). The legacy path is the social service's `transition` (compare-and-set on the status, compliance
 * re-checked at the gate, author may not approve a staff post). Approve = "approve", reject = "request_changes" with the note.
 * Nothing is ever published: an approved post is only a recorded intent.
 */
export type SocialRow = PostRow & { submittedAt: Date; authorName: string | null };

export type SocialAdapterDeps = {
  service: { transition(id: string, action: Exclude<PostAction, "edit">, input: { actor: { id: string; role: string }; confirmed?: boolean; note?: string }): Promise<ServiceResult> };
  loadAwaiting: (limit: number) => Promise<SocialRow[]>;
  loadRequestedBy: (userId: string, limit: number) => Promise<SocialRow[]>;
  loadRow: (id: string) => Promise<SocialRow | null>;
};

type Issue = { code?: string; message?: string };
const issuesOf = (v: unknown): Issue[] => (Array.isArray(v) ? (v as Issue[]) : []);

/** undefined = this post is not in an approval (a draft nobody has submitted). */
export function toCanonicalSocialPost(row: SocialRow): CanonicalApproval | undefined {
  const state = row.status === "NEEDS_REVIEW" ? "requested" : row.status === "APPROVED" || row.status === "SCHEDULED" ? "approved" : row.reviewNote ? "rejected" : null;
  if (!state) return undefined;
  const issues = issuesOf(row.complianceIssues);
  const channel = (SOCIAL_CHANNELS as Record<string, { label: string }>)[row.channel]?.label ?? row.channel;
  const label = row.title?.trim() || `${channel} post`;
  return {
    ref: refOf("social-post", row.id), kind: "social-post", id: row.id,
    subject: { type: "Social post", id: row.id, label, href: `/marketing?tab=posts&post=${row.id}` },
    state, legacyState: row.status,
    summary: `${row.source === "AI" ? "AI draft" : "Post"} for ${channel}: ${label}`,
    requestedBy: personOf(row.createdById, row.authorName), requestedAt: row.submittedAt,
    approver: personOf(row.approvedById), decidedAt: row.approvedAt, decisionReason: state === "rejected" ? row.reviewNote : null,
    expiresAt: null,
    evidence: [
      { key: "post", label: "Post text", value: clip(row.body, 4000) },
      { key: "compliance", label: "Compliance check", value: issues.length ? issues.map((i) => i.message ?? i.code ?? "issue").join("; ") : "No issues found" },
      { key: "channel", label: "Channel", value: channel },
      { key: "source", label: "Written by", value: row.source === "AI" ? "AI draft" : "Staff" },
    ],
    correlationId: defaultCorrelation("social-post", row.id), causationId: null, autonomy: "L3",
    // An AI draft has no human author, so (as in the legacy rule) the person who asked for it may approve it.
    fourEyesAuthorId: row.source === "AI" ? null : row.createdById,
    clientId: null,
  };
}

const RULES = [
  [/second pair of eyes/i, "SELF_APPROVAL"], [/changed while you were working|needs a post in/i, "ALREADY_DECIDED"], [/compliance check found/i, "BLOCKED"],
  [/Only an Admin or a marketing user/i, "FORBIDDEN"], [/no longer exists/i, "NOT_FOUND"], [/Confirm that you have read/i, "NEEDS_INPUT"], [/Say what needs to change/i, "REASON_REQUIRED"],
] as const;

export function createSocialPostAdapter(deps: SocialAdapterDeps): ApprovalAdapter {
  const views = (rows: SocialRow[]) => rows.map((r) => toCanonicalSocialPost(r)).filter((v): v is CanonicalApproval => !!v);
  const allowed = (actor: Actor) => canAccessMarketing(actor.role);
  return {
    kind: "social-post",
    async listAwaiting(actor, now, limit) {
      return allowed(actor) ? views(await deps.loadAwaiting(limit)).filter((v) => v.state === "requested") : [];
    },
    async listRequestedBy(actor, now, limit) {
      return allowed(actor) ? views(await deps.loadRequestedBy(actor.id, limit)) : [];
    },
    async get(id, actor, now) {
      if (!allowed(actor)) return null;
      const row = await deps.loadRow(id);
      return row ? (toCanonicalSocialPost(row) ?? null) : null;
    },
    async decide(input: DecideInput): Promise<LegacyOutcome> {
      const actor = { id: input.actor.id, role: input.actor.role as string };
      const res = input.decision === "approve" ? await deps.service.transition(input.subjectId, "approve", { actor, confirmed: input.params.confirmed === true }) : await deps.service.transition(input.subjectId, "request_changes", { actor, note: input.reason ?? "" });
      if (res.ok) return { ok: true };
      return failure(res.error, RULES, res.issues?.map((i) => i.message));
    },
  };
}
