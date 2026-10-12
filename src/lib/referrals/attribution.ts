/**
 * Decides whether a signup that carried a referral code is credited to the code's owner. Pure: the caller loads the
 * facts and writes the result. Rules, in order: the code must exist and have been live when the person signed up (history
 * is never rewritten by a later code or a later revocation); the referrer must be active; nobody refers themselves (same
 * customer, or the same phone, email or PAN); only a NEW person counts (someone already known is a duplicate, not a
 * referral); and the first referrer wins.
 */
export type CodeInfo = { id: string; referrerId: string; status: "ACTIVE" | "REVOKED"; createdAt: Date; revokedAt: Date | null };
export type Party = { clientId: string; phoneKey: string | null; emailKey: string | null; pan: string | null };

export type AttributionInput = {
  code: CodeInfo | null;
  referrerStatus: "ACTIVE" | "SUSPENDED";
  referrer: Party | null;
  referred: Party;
  /** What the lead intake said about the person: a new customer, one we already knew, or a replay of a signup that created one. */
  outcome: "created" | "duplicate";
  signedUpAt: Date;
  alreadyAttributed: boolean;
};

export type RejectReason = "UNKNOWN_CODE" | "CODE_NOT_YET_ISSUED" | "CODE_REVOKED" | "REFERRER_INACTIVE" | "SELF_REFERRAL" | "ALREADY_CUSTOMER" | "ALREADY_ATTRIBUTED";
export type AttributionDecision = { kind: "attribute"; codeId: string; referrerId: string } | { kind: "reject"; reason: RejectReason };

const reject = (reason: RejectReason): AttributionDecision => ({ kind: "reject", reason });
const same = (a: string | null, b: string | null) => a !== null && b !== null && a === b;

export function isSelf(referrer: Party, referred: Party): boolean {
  return referrer.clientId === referred.clientId || same(referrer.phoneKey, referred.phoneKey) || same(referrer.emailKey, referred.emailKey) || same(referrer.pan, referred.pan);
}

export function decideAttribution(input: AttributionInput): AttributionDecision {
  const { code, referrer, referred } = input;
  if (!code || !referrer) return reject("UNKNOWN_CODE");
  if (code.createdAt.getTime() > input.signedUpAt.getTime()) return reject("CODE_NOT_YET_ISSUED");
  if (code.status === "REVOKED" && (!code.revokedAt || code.revokedAt.getTime() <= input.signedUpAt.getTime())) return reject("CODE_REVOKED");
  if (input.referrerStatus !== "ACTIVE") return reject("REFERRER_INACTIVE");
  if (isSelf(referrer, referred)) return reject("SELF_REFERRAL");
  if (input.outcome === "duplicate") return reject("ALREADY_CUSTOMER");
  if (input.alreadyAttributed) return reject("ALREADY_ATTRIBUTED");
  return { kind: "attribute", codeId: code.id, referrerId: code.referrerId };
}
