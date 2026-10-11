import { describe, expect, it } from "vitest";

import { validateContent } from "./model";

const good = {
  name: "Example Fund A", category: "AIF", summary: null, availability: "OPEN", minInvestmentMinor: 100000, currency: "INR", riskCategory: "HIGH",
  jurisdictions: ["IN"], requiredDocuments: ["Offer document"], eligibility: [{ code: "inv", kind: "investor_type", value: "Example value" }],
  salesRestrictions: [{ code: "r1", text: "Example restriction" }], claims: [{ id: "c1", text: "Example claim", validUntil: null }], validFrom: null, validTo: null,
};

describe("validateContent", () => {
  it("accepts a complete example", () => expect(validateContent(good).ok).toBe(true));
  it("collects every error", () => {
    const r = validateContent({ ...good, name: "", category: "NOPE", jurisdictions: [], currency: "rupees" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(4);
  });
  it("rejects a negative or fractional minimum", () => {
    expect(validateContent({ ...good, minInvestmentMinor: -1 }).ok).toBe(false);
    expect(validateContent({ ...good, minInvestmentMinor: 1.5 }).ok).toBe(false);
  });
  it("rejects valid-to on or before valid-from and duplicate claim ids", () => {
    expect(validateContent({ ...good, validFrom: "2027-06-01", validTo: "2027-05-01" }).ok).toBe(false);
    expect(validateContent({ ...good, claims: [good.claims[0], good.claims[0]] }).ok).toBe(false);
  });
});
