import { describe, expect, it } from "vitest";

import { formatLines, formToContentInput, parseClaims, parseEligibility, parseRestrictions, rupeesToMinor, minorToRupees } from "./form-parse";

describe("form parsing", () => {
  it("rupees to minor units and back", () => {
    expect(rupeesToMinor("1,00,000")).toBe(10_000_000);
    expect(rupeesToMinor("2500.50")).toBe(250_050);
    expect(rupeesToMinor("")).toBeNull();
    expect(Number.isNaN(rupeesToMinor("abc") as number)).toBe(true);
    expect(minorToRupees(250_050)).toBe("2500.5");
    expect(minorToRupees(null)).toBe("");
  });
  it("claims: one per line, optional id and valid-until, ids generated when absent", () => {
    expect(parseClaims("Plain claim\nc9 | Second claim | 2028-01-31")).toEqual([
      { id: "claim-1", text: "Plain claim", validUntil: null },
      { id: "c9", text: "Second claim", validUntil: "2028-01-31" },
    ]);
  });
  it("restrictions and eligibility", () => {
    expect(parseRestrictions("No sales to X\nr2 | Needs approval")).toEqual([{ code: "restriction-1", text: "No sales to X" }, { code: "r2", text: "Needs approval" }]);
    expect(parseEligibility("investor_type: Example type\nkyc_complete: KYC complete")).toEqual([
      { code: "investor_type-1", kind: "investor_type", value: "Example type" },
      { code: "kyc_complete-2", kind: "kyc_complete", value: "KYC complete" },
    ]);
    expect(parseEligibility("just some text")).toEqual([{ code: "other-1", kind: "other", value: "just some text" }]);
  });
  it("blank lines are ignored and lines round trip", () => {
    expect(parseClaims("\n\n")).toEqual([]);
    const claims = parseClaims("c1 | Claim text | 2028-01-31");
    expect(parseClaims(formatLines.claims(claims))).toEqual(claims);
  });
  it("builds a validator input from form fields", () => {
    const input = formToContentInput({ name: " N ", category: "AIF", summary: "", availability: "OPEN", minInvestment: "1000", currency: "inr", riskCategory: "HIGH", jurisdictions: "IN, SG", requiredDocuments: "A\nB", eligibility: "", restrictions: "", claims: "", validFrom: "", validTo: "" });
    expect(input).toMatchObject({ name: " N ", minInvestmentMinor: 100_000, currency: "INR", jurisdictions: ["IN", "SG"], requiredDocuments: ["A", "B"], validFrom: null });
  });
});
