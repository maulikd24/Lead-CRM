import type { Role } from "@/generated/prisma/client";

import { assertAutonomy, type AutonomyProfile } from "./autonomy";
import type { ApprovalDefinition, ApprovalKind } from "./contract";

const profile = (level: AutonomyProfile["level"], extra: Partial<AutonomyProfile> = {}): AutonomyProfile => ({ level, customerFacing: false, adSpend: false, internalReversible: false, ...extra });
const ADMIN_FINANCE: readonly Role[] = ["ADMIN", "FINANCE"];
const ADMIN_MARKETING: readonly Role[] = ["ADMIN", "MARKETING"];

type Partial_ = Pick<ApprovalDefinition, "kind" | "label" | "group" | "subjectType" | "requesterRoles" | "approverRoles" | "fourEyes" | "requiredEvidence" | "autonomy"> & Partial<ApprovalDefinition>;
const def = (d: Partial_): ApprovalDefinition => ({
  expiry: { kind: "none" },
  preconditions: [],
  autoApprove: "never",
  supports: { approve: true, reject: true },
  approveNeeds: [],
  inlineApprove: true,
  adapter: "native",
  writeThroughFlag: null,
  ...d,
});

/**
 * Every approval the platform knows, in one table. Roles here are the roles of the LEGACY path as it is today (a test pins the
 * native ones to the generic registry, so they cannot drift). `adapter: "seam"` kinds belong to branches that are not merged
 * yet: only the definition exists, so the day their adapter lands it is one file and the ceilings are already enforced.
 */
export const DEFINITIONS: readonly ApprovalDefinition[] = [
  // ---- read-through adapters over legacy tables --------------------------------------------------------------------
  def({
    kind: "agent-proposal", label: "Agent draft message", group: "customer", subjectType: "Customer message", requesterRoles: "system", approverRoles: ["ADMIN", "RM"], fourEyes: false,
    expiry: { kind: "row" }, requiredEvidence: ["draft", "reason"], preconditions: [{ type: "consent", purpose: "MARKETING_COMMS", channel: "whatsapp" }, { type: "policy", name: "outbound-guardrails" }],
    autonomy: profile("L4", { customerFacing: true }), adapter: "read-through", writeThroughFlag: "APPROVALS_WT_AGENT_PROPOSAL",
  }),
  def({
    kind: "lead-push-draft", label: "New lead first message", group: "customer", subjectType: "Customer message", requesterRoles: "system", approverRoles: ["ADMIN", "RM"], fourEyes: false,
    expiry: { kind: "row" }, requiredEvidence: ["draft", "reason"], preconditions: [{ type: "consent", purpose: "MARKETING_COMMS", channel: "whatsapp" }, { type: "policy", name: "outbound-guardrails" }],
    autonomy: profile("L4", { customerFacing: true }), adapter: "read-through", writeThroughFlag: "APPROVALS_WT_LEAD_PUSH_DRAFT",
  }),
  def({
    kind: "social-post", label: "Social post", group: "marketing", subjectType: "Social post", requesterRoles: ADMIN_MARKETING, approverRoles: ADMIN_MARKETING, fourEyes: true,
    requiredEvidence: ["post", "compliance"], preconditions: [{ type: "policy", name: "social-compliance-check" }], approveNeeds: ["confirmed"],
    autonomy: profile("L3", { customerFacing: true }), adapter: "read-through", writeThroughFlag: "APPROVALS_WT_SOCIAL_POST",
  }),
  def({
    kind: "referral-statement", label: "Referral reward statement", group: "finance", subjectType: "Reward statement", requesterRoles: ADMIN_FINANCE, approverRoles: ADMIN_FINANCE, fourEyes: true,
    requiredEvidence: ["total", "lines"], preconditions: [{ type: "policy", name: "ledger-unchanged-since-prepared" }], supports: { approve: true, reject: false },
    autonomy: profile("L4"), adapter: "read-through", writeThroughFlag: "APPROVALS_WT_REFERRAL_STATEMENT",
  }),
  def({
    kind: "merge-suggestion", label: "Duplicate customer merge", group: "customer", subjectType: "Duplicate pair", requesterRoles: "system", approverRoles: ["ADMIN", "MANAGER", "RM"], fourEyes: false,
    requiredEvidence: ["reasons", "score"], approveNeeds: ["survivorId", "confirmed"], inlineApprove: false,
    autonomy: profile("L4"), adapter: "read-through", writeThroughFlag: "APPROVALS_WT_MERGE_SUGGESTION",
  }),
  def({
    kind: "ai-pilot-signoff", label: "AI assistant pilot sign-off", group: "admin", subjectType: "Pilot wording", requesterRoles: "system", approverRoles: ["ADMIN"], fourEyes: true,
    requiredEvidence: ["statement"], approveNeeds: ["acknowledged"], supports: { approve: true, reject: false },
    autonomy: profile("L4"), adapter: "read-through", writeThroughFlag: "APPROVALS_WT_AI_PILOT_SIGNOFF",
  }),
  // ---- native: the record already IS an ApprovalRequest -------------------------------------------------------------
  def({ kind: "payout-run", label: "Partner payout run", group: "finance", subjectType: "Payout run", requesterRoles: ADMIN_FINANCE, approverRoles: ["ADMIN"], fourEyes: true, requiredEvidence: ["period"], autonomy: profile("L4") }),
  def({ kind: "commission-adjustment", label: "Commission adjustment", group: "finance", subjectType: "Payout", requesterRoles: ADMIN_FINANCE, approverRoles: ["ADMIN"], fourEyes: true, requiredEvidence: ["amount", "reason"], autonomy: profile("L4") }),
  def({ kind: "erasure-request", label: "Data erasure request", group: "admin", subjectType: "Erasure request", requesterRoles: ADMIN_FINANCE, approverRoles: ["ADMIN"], fourEyes: true, requiredEvidence: ["subject"], autonomy: profile("L4") }),
  def({ kind: "partner-tax-rule", label: "Partner tax rule change", group: "finance", subjectType: "Tax rule", requesterRoles: ADMIN_FINANCE, approverRoles: ADMIN_FINANCE, fourEyes: true, requiredEvidence: ["change"], autonomy: profile("L4") }),
  def({ kind: "partner-override-rule", label: "Partner override rule change", group: "finance", subjectType: "Override rule", requesterRoles: ADMIN_FINANCE, approverRoles: ADMIN_FINANCE, fourEyes: true, requiredEvidence: ["change"], autonomy: profile("L4") }),
  def({ kind: "stage-override", label: "Stage correction", group: "customer", subjectType: "Customer", requesterRoles: ["MANAGER"], approverRoles: ["ADMIN"], fourEyes: true, requiredEvidence: ["reason"], autonomy: profile("L4") }),
  def({
    kind: "closed-loop-destination", label: "Ad destination switched on", group: "marketing", subjectType: "Ad destination", requesterRoles: ["ADMIN"], approverRoles: ["ADMIN"], fourEyes: true,
    requiredEvidence: ["destination", "regions"], preconditions: [{ type: "consent", purpose: "ADS_MEASUREMENT", channel: null }, { type: "policy", name: "destination-region-approved" }],
    autonomy: profile("L4"),
  }),
  def({
    kind: "consent-policy-change", label: "Consent wording change", group: "marketing", subjectType: "Consent notice", requesterRoles: ["ADMIN"], approverRoles: ["ADMIN"], fourEyes: true,
    requiredEvidence: ["wording", "version"], preconditions: [{ type: "policy", name: "compliance-owns-wording" }],
    autonomy: profile("L4", { customerFacing: true }),
  }),
  // ---- seams: sibling branches that are not on the train yet. Definition only; no adapter, no inbox rows. ------------
  def({ kind: "autopilot-action", label: "Autopilot ad action", group: "marketing", subjectType: "Ad recommendation", requesterRoles: "system", approverRoles: ADMIN_MARKETING, fourEyes: false, requiredEvidence: ["issue", "impact"], autonomy: profile("L4", { adSpend: true }), adapter: "seam" }),
  def({ kind: "ad-creative", label: "Ad creative variant", group: "marketing", subjectType: "Creative", requesterRoles: ADMIN_MARKETING, approverRoles: ADMIN_MARKETING, fourEyes: true, requiredEvidence: ["creative", "compliance"], autonomy: profile("L4", { customerFacing: true }), adapter: "seam" }),
];

export const KINDS: readonly ApprovalKind[] = DEFINITIONS.map((d) => d.kind);

// Checked once, when the module loads: a definition that breaks a ceiling can never be registered.
for (const d of DEFINITIONS) assertAutonomy(d.kind, d.autonomy);

const BY_KIND = new Map(DEFINITIONS.map((d) => [d.kind, d]));
export const isKind = (k: string): k is ApprovalKind => BY_KIND.has(k as ApprovalKind);
export function definitionOf(kind: ApprovalKind): ApprovalDefinition {
  const d = BY_KIND.get(kind);
  if (!d) throw new Error(`No approval definition for "${kind}"`);
  return d;
}

export const adapterKinds = () => DEFINITIONS.filter((d) => d.adapter !== "seam").map((d) => d.kind);
export const seamKinds = () => DEFINITIONS.filter((d) => d.adapter === "seam").map((d) => d.kind);

/** Roles are listed explicitly on every definition (ADMIN included), exactly as the legacy path allows them. No implicit superuser. */
export const mayApprove = (role: Role, kind: ApprovalKind) => definitionOf(kind).approverRoles.includes(role);
export function mayRequest(role: Role, kind: ApprovalKind): boolean {
  const r = definitionOf(kind).requesterRoles;
  return r !== "system" && r.includes(role);
}

const live = () => DEFINITIONS.filter((d) => d.adapter !== "seam");
/** Kinds whose open items this role can decide. */
export const approverKinds = (role: Role): ApprovalKind[] => live().filter((d) => d.approverRoles.includes(role)).map((d) => d.kind);
/** Kinds this role can request but not decide: they see only their own requests. */
export const requesterOnlyKinds = (role: Role): ApprovalKind[] => live().filter((d) => mayRequest(role, d.kind) && !mayApprove(role, d.kind)).map((d) => d.kind);
export const visibleKinds = (role: Role): ApprovalKind[] => [...new Set([...approverKinds(role), ...requesterOnlyKinds(role)])];
