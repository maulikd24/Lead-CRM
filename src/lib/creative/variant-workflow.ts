import { canAccessMarketing } from "@/lib/access/marketing-access";
import { approvalBlockedReason } from "@/lib/marketing/social/workflow";

/**
 * The status workflow for one creative variant: Draft > Needs review > Approved. Pure: it decides what a step would
 * change; the caller writes it. There is no "publish" step; approved copy is exported for the firm's ad-approval
 * annexure workflow and a person places the ad. A variant cannot move to Needs review or Approved while any rule fails
 * (the caller passes the result of checking the text as it is now), approval needs the reader's tick and, for copy a
 * person wrote, a second person (four eyes, the same rule as social posts).
 */

export const VARIANT_STATUSES = ["DRAFT", "NEEDS_REVIEW", "APPROVED"] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];
export const VARIANT_STATUS_LABEL: Record<VariantStatus, string> = { DRAFT: "Draft", NEEDS_REVIEW: "Needs review", APPROVED: "Approved" };

export type VariantAction = "submit" | "approve" | "request_changes" | "edit";
export type VariantSnapshot = { status: VariantStatus; /** The result of the rules run on the text as it is now. */ complianceStatus: "PASS" | "FAIL"; authorId: string; source: "STAFF" | "AI" };
export type VariantChange = { status: VariantStatus; approvedById?: string | null; approvedAt?: Date | null; reviewNote?: string | null };
export type VariantPlan = { ok: true; next: VariantChange; event: { action: VariantAction; from: VariantStatus; to: VariantStatus; note?: string } } | { ok: false; error: string };

const FROM: Record<Exclude<VariantAction, "edit">, VariantStatus> = { submit: "DRAFT", approve: "NEEDS_REVIEW", request_changes: "NEEDS_REVIEW" };
const fail = (error: string): VariantPlan => ({ ok: false, error });

export function planVariantTransition(input: { variant: VariantSnapshot; action: VariantAction; actor: { id: string; role: string }; confirmed?: boolean; note?: string; now?: Date }): VariantPlan {
  const { variant, action, actor } = input;
  if (!canAccessMarketing(actor.role)) return fail("Only an Admin or the marketing team can work on ad copy.");
  if (action !== "edit" && !(action in FROM)) return fail("That action does not exist. Ads are never published from here.");

  if (action === "edit") {
    const withdrew = variant.status === "APPROVED";
    return { ok: true, next: { status: "DRAFT", approvedById: null, approvedAt: null }, event: { action, from: variant.status, to: "DRAFT", ...(withdrew ? { note: "Approval withdrawn because the copy changed." } : {}) } };
  }

  if (variant.status !== FROM[action]) return fail(`This step needs a variant in "${VARIANT_STATUS_LABEL[FROM[action]]}"; this one is "${VARIANT_STATUS_LABEL[variant.status]}".`);

  if (action === "submit" || action === "approve") {
    if (variant.complianceStatus !== "PASS") return fail("One or more rules fail on the copy as it is now. Fix them, then try again.");
  }
  if (action === "submit") return { ok: true, next: { status: "NEEDS_REVIEW", reviewNote: null }, event: { action, from: "DRAFT", to: "NEEDS_REVIEW" } };

  if (action === "approve") {
    const blocked = approvalBlockedReason({ source: variant.source, authorId: variant.authorId }, actor.id);
    if (blocked) return fail(blocked);
    if (!input.confirmed) return fail("Tick the box to confirm you have read the copy and its checklist.");
    return { ok: true, next: { status: "APPROVED", approvedById: actor.id, approvedAt: input.now ?? new Date(), reviewNote: null }, event: { action, from: "NEEDS_REVIEW", to: "APPROVED" } };
  }

  const note = (input.note ?? "").trim();
  if (!note) return fail("Say what needs to change.");
  return { ok: true, next: { status: "DRAFT", reviewNote: note }, event: { action, from: "NEEDS_REVIEW", to: "DRAFT", note } };
}
