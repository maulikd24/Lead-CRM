/**
 * Precedence between a partner's code and a consumer referral code on the one signup webhook.
 *
 * The app sends its code in a single field (`referralCode`). Two programmes may own a code of that kind:
 *   1. A PARTNER code (the partner programme credits it first-touch, in the lead intake).
 *   2. A CONSUMER referral code (this programme: an existing customer inviting a friend).
 * The rule, in order:
 *   - A partner code is always credited to the partner, first touch, whatever else the payload carries. This programme
 *     never takes that credit away and never blocks it.
 *   - A code that is a partner code and NOT a consumer code belongs to the partner alone: no referral row is written
 *     (it would only show as a "rejected, unknown code" and distort the consumer statistics).
 *   - A payload that ALSO carries a consumer referral (the same string is both, or a separate partner code arrived next to a
 *     referral code) still records the referral, but flags it PARTNER_CODE_ALSO_PRESENT. The flag rides on every reward
 *     accrued from it, so a person decides in Needs review whether a reward is owed on top of the partner credit.
 *   - Anything else is a consumer referral, handled as before.
 * Pure: the caller looks the codes up and passes the facts in.
 */
export type CodeFacts = {
  referralCode: string | undefined;
  partnerCode: string | undefined;
  /** The value of `referralCode` is a known partner code. */
  partnerMatchesReferralCode: boolean;
  /** The value of `partnerCode` (a separate field, when the payload has one) is a known partner code. */
  partnerMatchesPartnerCode: boolean;
  /** The value of `referralCode` is a consumer referral code of this programme (any status). */
  consumerCodeExists: boolean;
};

export type CodeResolution = { partnerCredited: boolean; recordReferral: boolean; flags: string[] };

export const PARTNER_ALSO_FLAG = "PARTNER_CODE_ALSO_PRESENT";

export function resolveSignupCodes(f: CodeFacts): CodeResolution {
  const partnerCredited = (!!f.partnerCode && f.partnerMatchesPartnerCode) || (!!f.referralCode && f.partnerMatchesReferralCode);
  if (!f.referralCode) return { partnerCredited, recordReferral: false, flags: [] };
  if (f.partnerMatchesReferralCode && !f.consumerCodeExists) return { partnerCredited, recordReferral: false, flags: [] };
  return { partnerCredited, recordReferral: true, flags: partnerCredited ? [PARTNER_ALSO_FLAG] : [] };
}
