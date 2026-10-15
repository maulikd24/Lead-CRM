import { describe, expect, it } from "vitest";

import { evaluateEligibility, evaluatePredicate, rulesInForce, type EligibilityClient, type EligibilityProduct } from "./eligibility";

const NOW = new Date("2026-10-13T00:00:00Z");
const client: EligibilityClient = { kycStatus: "COMPLETE", kycComplete: true, riskProfile: "MODERATE", riskScore: 55, category: "HNI", jurisdiction: "IN", investableMinor: 50_000_000 };

const kycOk = { field: "kyc.complete" as const, op: "eq" as const, value: true };
const riskAtMost = { field: "risk.score" as const, op: "lte" as const, value: 70 };

function product(over: Partial<EligibilityProduct> = {}): EligibilityProduct {
  return {
    key: "p1",
    status: "APPROVED",
    minInvestmentMinor: 10_000_000,
    riskCategory: "HIGH",
    rules: [{ productKey: "p1", label: "KYC complete and risk within appetite", predicate: { all: [kycOk, riskAtMost] }, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }],
    ...over,
  };
}

describe("evaluatePredicate", () => {
  it("passes when the field meets the requirement", () => {
    expect(evaluatePredicate(kycOk, client)).toBeNull();
    expect(evaluatePredicate({ field: "client.category", op: "in", value: ["HNI", "UHNI"] }, client)).toBeNull();
  });

  it("fails with a reason when the field does not meet the requirement", () => {
    expect(evaluatePredicate({ field: "risk.score", op: "lte", value: 40 }, client)).toMatch(/does not meet/);
    expect(evaluatePredicate({ field: "client.jurisdiction", op: "neq", value: "IN" }, client)).toMatch(/does not meet/);
  });

  it("fails closed on a missing risk score, an unknown field or a malformed node", () => {
    expect(evaluatePredicate({ field: "risk.score", op: "lte", value: 70 }, { ...client, riskScore: null })).toMatch(/not known/);
    expect(evaluatePredicate({ field: "kyc.pan", op: "eq", value: "x" }, client)).toBe("rule is malformed");
    expect(evaluatePredicate({ all: [] }, client)).toBe("rule is malformed");
    expect(evaluatePredicate("yes", client)).toBe("rule is malformed");
  });

  it("supports any and not", () => {
    expect(evaluatePredicate({ any: [{ field: "client.category", op: "eq", value: "RETAIL" }, kycOk] }, client)).toBeNull();
    expect(evaluatePredicate({ any: [{ field: "client.category", op: "eq", value: "RETAIL" }] }, client)).not.toBeNull();
    expect(evaluatePredicate({ not: kycOk }, client)).toBe("an excluded condition holds");
    expect(evaluatePredicate({ not: { field: "client.category", op: "eq", value: "RETAIL" } }, client)).toBeNull();
  });
});

describe("evaluateEligibility", () => {
  it("is eligible when the product is approved, a rule is in force and it passes, and the ticket is met", () => {
    const r = evaluateEligibility(product(), client, NOW);
    expect(r).toEqual({ eligible: true, reasons: [], rulesPassed: ["KYC complete and risk within appetite"] });
  });

  it("refuses a product that is not approved, even when the rules pass", () => {
    for (const status of ["DRAFT", "SUSPENDED", "RETIRED"]) {
      const r = evaluateEligibility(product({ status }), client, NOW);
      expect(r.eligible).toBe(false);
      expect(r.reasons[0]).toMatch(/not approved/);
    }
  });

  it("refuses when no rule is in force on the date (fail closed, never eligible by default)", () => {
    expect(evaluateEligibility(product({ rules: [] }), client, NOW).reasons).toEqual(["no eligibility rule is in force for this product on this date"]);
  });

  it("respects effective dates: a rule not yet effective or already ended does not count", () => {
    const future = { productKey: "p1", label: "future", predicate: kycOk, effectiveFrom: new Date("2027-01-01"), effectiveTo: null };
    const ended = { productKey: "p1", label: "ended", predicate: kycOk, effectiveFrom: new Date("2025-01-01"), effectiveTo: new Date("2026-01-01") };
    const r = evaluateEligibility(product({ rules: [future, ended] }), client, NOW);
    expect(rulesInForce(product({ rules: [future, ended] }), NOW)).toEqual([]);
    expect(r.eligible).toBe(false);
  });

  it("the end date is exclusive: a rule ending exactly at asOf is no longer in force", () => {
    const ending = { productKey: "p1", label: "ends now", predicate: kycOk, effectiveFrom: new Date("2025-01-01"), effectiveTo: NOW };
    expect(rulesInForce(product({ rules: [ending] }), NOW)).toEqual([]);
  });

  it("requires every rule in force to pass", () => {
    const strict = { productKey: "p1", label: "HNI only", predicate: { field: "client.category" as const, op: "eq" as const, value: "UHNI" }, effectiveFrom: new Date("2026-01-01"), effectiveTo: null };
    const r = evaluateEligibility(product({ rules: [...product().rules, strict] }), client, NOW);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toEqual(["HNI only: client.category does not meet the requirement"]);
  });

  it("ignores rules that belong to another product key", () => {
    const other = { productKey: "p2", label: "other", predicate: { field: "client.category" as const, op: "eq" as const, value: "UHNI" }, effectiveFrom: new Date("2026-01-01"), effectiveTo: null };
    expect(evaluateEligibility(product({ rules: [...product().rules, other] }), client, NOW).eligible).toBe(true);
  });

  it("refuses when the investable amount is below the minimum ticket, and when it is unknown", () => {
    expect(evaluateEligibility(product({ minInvestmentMinor: 60_000_000 }), client, NOW).reasons).toEqual(["investable amount is below the product minimum"]);
    expect(evaluateEligibility(product(), { ...client, investableMinor: null }, NOW).reasons).toEqual(["investable amount is unknown, so the minimum ticket cannot be confirmed"]);
  });

  it("does not check the ticket when the caller did not supply an amount, and skips it when the product has no minimum", () => {
    expect(evaluateEligibility(product(), { ...client, investableMinor: undefined }, NOW).eligible).toBe(true);
    expect(evaluateEligibility(product({ minInvestmentMinor: null }), { ...client, investableMinor: null }, NOW).eligible).toBe(true);
  });
});
