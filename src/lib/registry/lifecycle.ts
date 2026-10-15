import type { ProductStatus, VersionState } from "./model";

/**
 * The draft > review > approved flow as pure functions. This is the SMALL ADDITIVE ADAPTER the brief asks for: until the one
 * canonical approval service of Wave 1 is merged, a version moves through DRAFT, IN_REVIEW, APPROVED here, with a maker-checker
 * rule (the author cannot approve) and an ADMIN-only gate. At integration, `decideReview` is the seam: replace the call in
 * `store.ts` with an ApprovalRequest of action type PRODUCT_REGISTRY_CHANGE and call `applyApproved` from its executor.
 *
 * Safe direction is instant (suspend, retire); the risky direction (making something citable) always needs a second person.
 */

export type Actor = { userId: string; role: string };
export type VersionMeta = { id: string; productId: string; state: VersionState; createdById: string | null };
export type HeadMeta = { id: string; status: ProductStatus; activeVersionId: string | null };

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });
const isAdmin = (a: Actor) => a.role === "ADMIN";

export function submitForReview(version: VersionMeta, actor: Actor): { ok: true; state: "IN_REVIEW" } | Fail {
  if (!isAdmin(actor)) return fail("Only an Admin can submit a version for review.");
  if (version.state !== "DRAFT") return fail("Only a draft can be submitted for review.");
  return { ok: true, state: "IN_REVIEW" };
}

export type ReviewResult =
  | { ok: true; versionState: "APPROVED"; product: { status: "APPROVED"; activeVersionId: string }; supersede: string | null }
  | { ok: true; versionState: "REJECTED"; product: null; supersede: null }
  | Fail;

export function decideReview(head: HeadMeta, version: VersionMeta, actor: Actor, decision: "approve" | "reject"): ReviewResult {
  if (!isAdmin(actor)) return fail("Only an Admin can review a version.");
  if (version.state !== "IN_REVIEW") return fail("Only a version that is in review can be decided.");
  if (version.productId !== head.id) return fail("This version belongs to another product.");
  if (head.status === "RETIRED") return fail("A retired product cannot be changed.");
  if (decision === "reject") return { ok: true, versionState: "REJECTED", product: null, supersede: null };
  if (version.createdById !== null && version.createdById === actor.userId) return fail("The author cannot approve their own version: a second Admin must review it.");
  return {
    ok: true,
    versionState: "APPROVED",
    product: { status: "APPROVED", activeVersionId: version.id },
    supersede: head.activeVersionId && head.activeVersionId !== version.id ? head.activeVersionId : null,
  };
}

export function suspend(head: HeadMeta, actor: Actor, reason: string): { ok: true; status: "SUSPENDED" } | Fail {
  if (!isAdmin(actor)) return fail("Only an Admin can suspend a product.");
  if (reason.trim().length === 0) return fail("A reason is required to suspend a product.");
  if (head.status !== "APPROVED") return fail("Only an approved product can be suspended.");
  return { ok: true, status: "SUSPENDED" };
}

export function retire(head: HeadMeta, actor: Actor, reason: string): { ok: true; status: "RETIRED" } | Fail {
  if (!isAdmin(actor)) return fail("Only an Admin can retire a product.");
  if (reason.trim().length === 0) return fail("A reason is required to retire a product.");
  if (head.status === "RETIRED") return fail("This product is already retired.");
  return { ok: true, status: "RETIRED" };
}
