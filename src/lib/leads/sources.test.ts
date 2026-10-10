import { describe, expect, it } from "vitest";

import { pickPartnerRef, PARTNER_REF_KEYS } from "./sources";

describe("pickPartnerRef: the referral code a partner's link put in a web form", () => {
  it("reads ref, partnerCode or partner_code, in that order, from text values only", () => {
    expect(pickPartnerRef({ ref: "PTR-00001", partnerCode: "PTR-00002" })).toBe("PTR-00001");
    expect(pickPartnerRef({ partnerCode: "PTR-00002" })).toBe("PTR-00002");
    expect(pickPartnerRef({ partner_code: "PTR-00003" })).toBe("PTR-00003");
  });
  it("is undefined for anything that is not a non-empty string", () => {
    for (const v of [undefined, null, 5, {}, [], "", "   "]) expect(pickPartnerRef({ ref: v })).toBeUndefined();
    expect(pickPartnerRef({})).toBeUndefined();
  });
  it("hands over the text as sent: it is looked up, never trusted", () => {
    expect(pickPartnerRef({ ref: "  x'; --  " })).toBe("x'; --");
  });
  it("names the keys, so the form handler keeps them out of the enquiry notes", () => {
    expect(PARTNER_REF_KEYS).toEqual(["ref", "partnercode", "partner_code"]);
  });
});
