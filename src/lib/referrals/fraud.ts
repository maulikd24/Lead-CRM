import type { Party } from "./attribution";

/**
 * Abuse checks run when a reward is about to accrue. A flag never blocks the accrual itself: it puts the entry in
 * Needs review, where an Admin or Finance person looks at it and either clears it or reverses it. Matching uses the same
 * identity keys as the rest of the CRM (phone, email, PAN); the signup feed carries no device identifier, so a same-device
 * check is not possible yet.
 */
export type FraudFlag =
  | "VELOCITY"
  | "SHARES_PHONE_WITH_REFERRER"
  | "SHARES_EMAIL_WITH_REFERRER"
  | "SHARES_PAN_WITH_REFERRER"
  | "SIBLING_PHONE_COLLISION"
  | "SIBLING_EMAIL_COLLISION"
  | "SIBLING_PAN_COLLISION"
  | "CAP_APPLIED";

export type FraudInput = {
  referrer: Party;
  referred: Party;
  /** The referrer's other referred people. */
  siblings: Party[];
  /** How many people this referrer got attributed in the 24 hours before this one. */
  attributionsLast24h: number;
  velocityLimit: number;
  capped: boolean;
};

export const DEFAULT_VELOCITY_LIMIT = 5;

const hit = (a: string | null, b: string | null) => a !== null && b !== null && a === b;

export function fraudFlags(i: FraudInput): FraudFlag[] {
  const out: FraudFlag[] = [];
  if (i.attributionsLast24h > i.velocityLimit) out.push("VELOCITY");
  if (hit(i.referrer.phoneKey, i.referred.phoneKey)) out.push("SHARES_PHONE_WITH_REFERRER");
  if (hit(i.referrer.emailKey, i.referred.emailKey)) out.push("SHARES_EMAIL_WITH_REFERRER");
  if (hit(i.referrer.pan, i.referred.pan)) out.push("SHARES_PAN_WITH_REFERRER");
  const others = i.siblings.filter((s) => s.clientId !== i.referred.clientId);
  if (others.some((s) => hit(s.phoneKey, i.referred.phoneKey))) out.push("SIBLING_PHONE_COLLISION");
  if (others.some((s) => hit(s.emailKey, i.referred.emailKey))) out.push("SIBLING_EMAIL_COLLISION");
  if (others.some((s) => hit(s.pan, i.referred.pan))) out.push("SIBLING_PAN_COLLISION");
  if (i.capped) out.push("CAP_APPLIED");
  return out;
}

export const FLAG_LABEL: Record<FraudFlag, string> = {
  VELOCITY: "Many referrals in one day",
  SHARES_PHONE_WITH_REFERRER: "Same phone as the referrer",
  SHARES_EMAIL_WITH_REFERRER: "Same email as the referrer",
  SHARES_PAN_WITH_REFERRER: "Same PAN as the referrer",
  SIBLING_PHONE_COLLISION: "Same phone as another referral",
  SIBLING_EMAIL_COLLISION: "Same email as another referral",
  SIBLING_PAN_COLLISION: "Same PAN as another referral",
  CAP_APPLIED: "Monthly cap trimmed this reward",
};
