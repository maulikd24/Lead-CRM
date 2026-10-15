import type { Role } from "@/generated/prisma/client";

import type { AutonomyLevel, AutonomyProfile } from "./autonomy";
import type { CanonicalState } from "./state";

/**
 * The canonical approval contract. ONE shape for every kind of approval; each existing path keeps its own table and its own
 * rules and is exposed through an adapter. Nothing here reads a table. See docs/approvals.md.
 */
export type ApprovalKind =
  | "agent-proposal" | "social-post" | "referral-statement" | "merge-suggestion" | "ai-pilot-signoff"
  | "payout-run" | "commission-adjustment" | "erasure-request" | "partner-tax-rule" | "partner-override-rule" | "stage-override" | "client-mobile-change"
  | "autopilot-action" | "ad-creative" | "lead-push-draft"
  | "product-registry-change"
  | "closed-loop-destination" | "consent-policy-change" | "director-report" | "planner-plan";

export type Actor = { id: string; role: Role; name?: string | null };

/** What the approver is shown to decide on: a label and one plain-text value. Never a contact detail or an identifier number. */
export type Evidence = { key: string; label: string; value: string };
export type SubjectRef = { type: string; id: string; label: string; href: string | null };
export type Person = { id: string; name: string | null };

export type Precondition =
  | { type: "consent"; purpose: string; channel: string | null }
  /** Enforced by the legacy path (named here so the contract says what must hold); the service does not re-implement it. */
  | { type: "policy"; name: string };

export type ApproveNeed = "confirmed" | "survivorId" | "acknowledged";

export type ApprovalDefinition = {
  kind: ApprovalKind;
  label: string;
  group: "customer" | "marketing" | "finance" | "admin";
  /** Whose record it is; shown as the subject type. */
  subjectType: string;
  /** "system" = created by a job or an agent, never by a person. */
  requesterRoles: readonly Role[] | "system";
  approverRoles: readonly Role[];
  /** The requester (or author) may not approve their own request. Enforced by the legacy path AND again by the canonical service. */
  fourEyes: boolean;
  expiry: { kind: "none" } | { kind: "row" } | { kind: "ttl"; hours: number };
  /** Evidence keys the view must carry before an inline approval is offered. */
  requiredEvidence: readonly string[];
  preconditions: readonly Precondition[];
  autonomy: AutonomyProfile;
  /** There is no auto-approval of anything. The literal type makes it impossible to declare one. */
  autoApprove: "never";
  supports: { approve: boolean; reject: boolean };
  /** Extra input an approval needs (a tick, a choice). */
  approveNeeds: readonly ApproveNeed[];
  /** false: the approval is irreversible or needs a choice, so the inbox links to the subject instead of approving in place. */
  inlineApprove: boolean;
  /** native = the record IS an ApprovalRequest; read-through = a legacy table, mapped; seam = definition only, no adapter yet. */
  adapter: "native" | "read-through" | "seam";
  /** Env flag that makes decisions through the canonical service also write a canonical record. null for native and seam kinds. */
  writeThroughFlag: string | null;
};

/** One approval as the canonical layer sees it. Derived from the legacy record; the legacy record stays authoritative. */
export type CanonicalApproval = {
  /** `${kind}:${id}`: the handle the inbox decides on. id is the legacy decision target (a row id). */
  ref: string;
  kind: ApprovalKind;
  id: string;
  subject: SubjectRef;
  state: CanonicalState;
  /** The legacy record's own state word, for display and for the equivalence tests. */
  legacyState: string;
  summary: string;
  requestedBy: Person | null;
  requestedAt: Date;
  approver: Person | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  expiresAt: Date | null;
  evidence: Evidence[];
  correlationId: string;
  causationId: string | null;
  autonomy: AutonomyLevel;
  /** The person who may NOT approve this one because they made it (four-eyes), or null. AI drafts have none. */
  fourEyesAuthorId: string | null;
  /** The customer, when the subject is about one: the preconditions are checked against it. */
  clientId: string | null;
};

export type FailureCode =
  | "NOT_FOUND" | "FORBIDDEN" | "SELF_APPROVAL" | "ALREADY_DECIDED" | "EXPIRED" | "BLOCKED" | "REASON_REQUIRED" | "EVIDENCE_MISSING"
  | "PRECONDITION" | "UNSUPPORTED" | "NEEDS_INPUT" | "NOT_HUMAN" | "INVALID" | "ERROR";

/** What an adapter reports after calling the legacy path. */
export type LegacyOutcome = { ok: true; messageId?: string } | { ok: false; code: FailureCode; error: string; reasons?: string[] };

export type DecisionResult =
  | { ok: true; state: CanonicalState; approval: CanonicalApproval | null; messageId?: string }
  | { ok: false; code: FailureCode; error: string; reasons?: string[] };

export type Decision = "approve" | "reject";

export type DecideInput = { subjectId: string; decision: Decision; reason: string | null; actor: Actor; now: Date; params: Record<string, unknown> };

export interface ApprovalAdapter {
  kind: ApprovalKind;
  /** Open (requested) items this person may act on, already scoped by the legacy rule. Newest-waiting first is the service's job. */
  listAwaiting(actor: Actor, now: Date, limit: number): Promise<CanonicalApproval[]>;
  /** Items this person asked for (any state, newest first). Empty for kinds nobody requests by hand. */
  listRequestedBy(actor: Actor, now: Date, limit: number): Promise<CanonicalApproval[]>;
  /** One item as THIS actor may see it, or null (not found and not visible look the same). */
  get(id: string, actor: Actor, now: Date): Promise<CanonicalApproval | null>;
  /** Calls the legacy path. Never decides policy of its own. */
  decide(input: DecideInput): Promise<LegacyOutcome>;
  /** Records an expiry the legacy path would also record (optional). */
  expire?(id: string, now: Date): Promise<void>;
}

export const refOf = (kind: ApprovalKind, id: string) => `${kind}:${id}`;
export function parseRef(ref: unknown): { kind: string; id: string } | null {
  if (typeof ref !== "string") return null;
  const i = ref.indexOf(":");
  if (i <= 0 || i === ref.length - 1 || ref.length > 200) return null;
  return { kind: ref.slice(0, i), id: ref.slice(i + 1) };
}

/** Until a request carries correlation ids of its own, the chain is anchored on the record itself (stable, no new column on legacy tables). */
export const defaultCorrelation = (kind: ApprovalKind, id: string) => `approval:${kind}:${id}`;
