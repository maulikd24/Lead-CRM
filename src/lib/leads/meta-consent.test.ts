import { describe, expect, it } from "vitest";

import { metaConsentGiven } from "./meta-consent";

describe("metaConsentGiven", () => {
  it("is given when the consent checkbox is answered yes", () => {
    expect(metaConsentGiven({ full_name: "A", consent: "yes" })).toBe(true);
    expect(metaConsentGiven({ i_agree_to_be_contacted: "true" })).toBe(true);
    expect(metaConsentGiven({ marketing_consent: " On " })).toBe(true);
  });

  it("is refused when answered no, left blank, or when there is no consent field at all", () => {
    expect(metaConsentGiven({ consent: "no" })).toBe(false);
    expect(metaConsentGiven({ consent: "" })).toBe(false);
    expect(metaConsentGiven({ full_name: "A", phone_number: "+919999999999" })).toBe(false);
  });

  it("does not read a yes from a field that is not a consent field", () => {
    expect(metaConsentGiven({ city: "yes" })).toBe(false);
  });
});
