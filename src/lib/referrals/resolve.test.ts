import { describe, expect, it } from "vitest";

import { resolveSignupCodes, type CodeFacts } from "./resolve";

const none: CodeFacts = { referralCode: undefined, partnerCode: undefined, partnerMatchesReferralCode: false, partnerMatchesPartnerCode: false, consumerCodeExists: false };
const r = (over: Partial<CodeFacts>) => resolveSignupCodes({ ...none, ...over });

describe("which module credits a signup that carried a code", () => {
  it("no code at all: nothing for either module", () => {
    expect(r({})).toEqual({ partnerCredited: false, recordReferral: false, flags: [] });
  });
  it("a consumer referral code alone is recorded, with no flag", () => {
    expect(r({ referralCode: "ABCD2345", consumerCodeExists: true })).toEqual({ partnerCredited: false, recordReferral: true, flags: [] });
  });
  it("a code unknown to both is still recorded (as a rejected claim, exactly as before)", () => {
    expect(r({ referralCode: "NOPE2345" })).toEqual({ partnerCredited: false, recordReferral: true, flags: [] });
  });
  it("a PARTNER code on the shared field is the partner's alone: no referral row, no rejected claim polluting the consumer statistics", () => {
    expect(r({ referralCode: "PRTN2345", partnerMatchesReferralCode: true })).toEqual({ partnerCredited: true, recordReferral: false, flags: [] });
  });
  it("the same string being both a partner code and a consumer code: partner credited first-touch AND the referral recorded, flagged for review", () => {
    expect(r({ referralCode: "BOTH2345", partnerMatchesReferralCode: true, consumerCodeExists: true })).toEqual({ partnerCredited: true, recordReferral: true, flags: ["PARTNER_CODE_ALSO_PRESENT"] });
  });
  it("a payload with a separate partner code and a consumer referral code: same rule", () => {
    expect(r({ referralCode: "ABCD2345", consumerCodeExists: true, partnerCode: "PRTN2345", partnerMatchesPartnerCode: true })).toEqual({ partnerCredited: true, recordReferral: true, flags: ["PARTNER_CODE_ALSO_PRESENT"] });
  });
  it("a separate partner code with no referral code: the partner's alone", () => {
    expect(r({ partnerCode: "PRTN2345", partnerMatchesPartnerCode: true })).toEqual({ partnerCredited: true, recordReferral: false, flags: [] });
  });
  it("a partner code that matches no partner does not stop a valid referral and raises no flag", () => {
    expect(r({ referralCode: "ABCD2345", consumerCodeExists: true, partnerCode: "NOPE2345", partnerMatchesPartnerCode: false })).toEqual({ partnerCredited: false, recordReferral: true, flags: [] });
  });
  it("the partner never loses the credit to the referral, whatever the combination", () => {
    for (const consumerCodeExists of [true, false]) for (const viaReferral of [true, false]) {
      const out = r({ referralCode: "X", consumerCodeExists, partnerMatchesReferralCode: viaReferral, partnerCode: "Y", partnerMatchesPartnerCode: !viaReferral });
      expect(out.partnerCredited).toBe(true);
    }
  });
  it("the flag appears only when BOTH a partner and a referral are in play", () => {
    for (const consumerCodeExists of [true, false]) for (const pm of [true, false]) {
      const out = r({ referralCode: "X", consumerCodeExists, partnerMatchesReferralCode: pm });
      expect(out.flags.length > 0).toBe(consumerCodeExists && pm);
    }
  });
});
