import { describe, expect, it } from "vitest";

import { DISCLAIMER_TEXT, checkPromise } from "./guardrails";

const GOOD = {
  hook: "See if you are on track for retirement",
  evidence: "Uses the in-app retirement planner; the assumptions screen is shown before any result.",
  product: "Retirement goal planner",
  allowedClaims: ["Shows a projection based on the inputs you enter", "Free to use"],
  disallowedClaims: ["Any return figure", "Guaranteed or assured outcomes"],
};

const failed = (r: ReturnType<typeof checkPromise>) => r.items.filter((i) => i.status === "fail").map((i) => i.id);

describe("promise guardrail checklist", () => {
  it("passes a calm, educational promise, and shows every item as pass", () => {
    const r = checkPromise(GOOD);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.id)).toEqual(["no_guaranteed_returns", "no_unsuitable_advice", "no_urgency_or_scarcity", "no_hype_or_superlatives", "evidence_present", "claims_defined", "disclaimer"]);
    expect(r.items.every((i) => i.status === "pass" && i.label.length > 5)).toBe(true);
  });
  it("fails guaranteed or assured returns in the hook", () => {
    for (const hook of ["Guaranteed 12% returns on your SIP", "Assured returns every month", "Risk-free wealth"]) {
      expect(failed(checkPromise({ ...GOOD, hook })), hook).toContain("no_guaranteed_returns");
    }
  });
  it("fails guaranteed returns hidden in an allowed claim", () => {
    expect(failed(checkPromise({ ...GOOD, allowedClaims: ["Assured returns"] }))).toContain("no_guaranteed_returns");
  });
  it("fails advice that is not suitability-checked", () => {
    expect(failed(checkPromise({ ...GOOD, hook: "You should buy this fund now" }))).toContain("no_unsuitable_advice");
  });
  it("fails urgency and scarcity for investment products, but allows a plain seasonal fact", () => {
    for (const hook of ["Last chance to invest", "Only 50 seats left", "Hurry, offer ends today", "Limited time SIP offer"]) {
      expect(failed(checkPromise({ ...GOOD, hook })), hook).toContain("no_urgency_or_scarcity");
    }
    expect(checkPromise({ ...GOOD, hook: "Tax-saving options before March" }).ok).toBe(true);
  });
  it("fails superlatives and hype", () => {
    expect(failed(checkPromise({ ...GOOD, hook: "The best fund in India" }))).toContain("no_hype_or_superlatives");
    expect(failed(checkPromise({ ...GOOD, hook: "Get rich with insider tips" }))).toContain("no_hype_or_superlatives");
  });
  it("fails when there is no evidence or no claims listed", () => {
    expect(failed(checkPromise({ ...GOOD, evidence: "  " }))).toContain("evidence_present");
    expect(failed(checkPromise({ ...GOOD, allowedClaims: [] }))).toContain("claims_defined");
    expect(failed(checkPromise({ ...GOOD, disallowedClaims: [] }))).toContain("claims_defined");
  });
  it("fails an empty hook", () => {
    expect(checkPromise({ ...GOOD, hook: "" }).ok).toBe(false);
  });
  it("reports a failure with a message that says what to change", () => {
    const item = checkPromise({ ...GOOD, hook: "Guaranteed returns" }).items.find((i) => i.id === "no_guaranteed_returns");
    expect(item?.status).toBe("fail");
    expect(item?.detail).toMatch(/guarantee|assured|return/i);
  });
  it("the mandatory disclaimer is the market-risk statement", () => {
    expect(DISCLAIMER_TEXT).toMatch(/subject to market risks/i);
  });
});
