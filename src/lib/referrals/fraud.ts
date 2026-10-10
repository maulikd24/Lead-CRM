import type { Party } from "./attribution";

/**
 * Abuse checks run when a reward is about to accrue. A flag never blocks the accrual itself: it puts the entry in
 * Needs review, where an Admin or Finance person looks at it and either clears it or reverses it. Matching uses the same
 * identity keys as the rest of the CRM (phone, email, PAN) and, when the app sends a device identifier, its keyed hash.
 * There is no IP check: the signup feed comes from the app's servers, so the address seen is not the customer's.
 */
export type FraudFlag =
  | "VELOCITY"
  | "SHARES_PHONE_WITH_REFERRER"
  | "SHARES_EMAIL_WITH_REFERRER"
  | "SHARES_PAN_WITH_REFERRER"
  | "SIBLING_PHONE_COLLISION"
  | "SIBLING_EMAIL_COLLISION"
  | "SIBLING_PAN_COLLISION"
  | "SHARES_DEVICE_WITH_REFERRER"
  | "SIBLING_DEVICE_COLLISION"
  | "DEVICE_SHARED_ACROSS_REFERRERS"
  | "PARTNER_CODE_ALSO_PRESENT"
  | "CAP_APPLIED";

/** Hashed device identifiers (never raw) as the store found them. Empty lists mean the app sent none, which can never raise a flag. */
export type DeviceFacts = {
  /** Devices seen on the referred person's signup. */
  referred: string[];
  /** Devices seen on the referrer's own signup. */
  referrer: string[];
  /** Devices seen on the referrer's OTHER referred people. */
  siblings: string[];
  /** How many referred people under OTHER referrers were seen on any of the referred person's devices. */
  otherReferrerReferrals: number;
};

export type FraudInput = {
  referrer: Party;
  referred: Party;
  /** The referrer's other referred people. */
  siblings: Party[];
  /** How many people this referrer got attributed in the 24 hours before this one. */
  attributionsLast24h: number;
  velocityLimit: number;
  capped: boolean;
  /** Optional: hashed device facts. Without them no device check runs. */
  devices?: DeviceFacts;
  /** Flags decided when the signup was credited (for example a partner code arrived too). They carry onto every reward. */
  referralFlags?: string[];
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
  const d = i.devices;
  if (d && d.referred.length > 0) {
    if (d.referred.some((h) => d.referrer.includes(h))) out.push("SHARES_DEVICE_WITH_REFERRER");
    if (d.referred.some((h) => d.siblings.includes(h))) out.push("SIBLING_DEVICE_COLLISION");
    if (d.otherReferrerReferrals > 0) out.push("DEVICE_SHARED_ACROSS_REFERRERS");
  }
  if (i.capped) out.push("CAP_APPLIED");
  if (i.referralFlags?.includes("PARTNER_CODE_ALSO_PRESENT")) out.push("PARTNER_CODE_ALSO_PRESENT");
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
  SHARES_DEVICE_WITH_REFERRER: "Same device as the referrer",
  SIBLING_DEVICE_COLLISION: "Same device as another referral",
  DEVICE_SHARED_ACROSS_REFERRERS: "Same device seen under a different referrer",
  PARTNER_CODE_ALSO_PRESENT: "A partner code came with this signup too",
  CAP_APPLIED: "Monthly cap trimmed this reward",
};

export const CLAWBACK_FLAG_LABEL = {
  CLAWBACK_KYC_REVOKED: "Taken back: KYC was revoked inside the window",
  CLAWBACK_FUNDING_REVERSED: "Taken back: the funding was reversed inside the window",
} as const;
