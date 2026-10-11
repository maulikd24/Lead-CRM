import { createHash } from "node:crypto";

/**
 * compliance review: pending
 *
 * The ONLY place the trust-strip wording lives. The strip is not shown on the front door until an Admin records a
 * compliance sign-off for exactly this wording (Settings, Sign-in). The sign-off stores a hash of the text below, so
 * changing a single character here switches the strip off again until it is reviewed and signed off again.
 *
 * Keep every statement to what the platform does today: consent ledger, audit trail, role segregation, AI drafts that need
 * a person's approval. No regulatory, certification, residency, security-grade or performance claims.
 */
export const TRUST_REVIEW_STATUS = "compliance review: pending";

export type TrustItem = { id: "consent" | "audit" | "roles" | "humans"; title: string; body: string };

export const TRUST_HEADING = { eyebrow: "Built to be trusted", title: "Careful by default." } as const;

export const TRUST_ITEMS: readonly TrustItem[] = [
  { id: "consent", title: "Consent ledger", body: "Consent is recorded in a ledger. Where enforcement is switched on, a message draft is checked against it first." },
  { id: "audit", title: "Audit trail", body: "Changes are recorded with who made them and when. The records are chained, so a missing entry shows." },
  { id: "roles", title: "Role segregation", body: "Access is denied unless a role is granted it. Marketing and customer work are kept apart." },
  { id: "humans", title: "AI drafts need a person", body: "AI prepares drafts and briefs. Nothing is sent to a customer without a person's approval." },
];

/** A short stable fingerprint of the wording (heading and items). */
export function trustStatementHash(items: readonly TrustItem[] = TRUST_ITEMS): string {
  return createHash("sha256").update(JSON.stringify([TRUST_HEADING, items])).digest("hex").slice(0, 32);
}
