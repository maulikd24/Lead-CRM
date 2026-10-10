import { describe, expect, it } from "vitest";

import { computeReward, monthKeyIST, ruleApplies, validateRuleInput, type RuleSpec } from "./rewards";

const rule = (over: Partial<RuleSpec> = {}): RuleSpec => ({ id: "r1", event: "KYC_COMPLETE", kind: "FIXED", fixedPaise: 10000, percentBps: null, maxRewardPaise: null, capPerReferrerMonthPaise: null, validFrom: null, validTo: null, active: true, ...over });
const at = new Date("2027-01-15T10:00:00Z");

describe("ruleApplies", () => {
  it("needs an active rule for the same event", () => {
    expect(ruleApplies(rule(), { type: "KYC_COMPLETE", occurredAt: at })).toBe(true);
    expect(ruleApplies(rule({ active: false }), { type: "KYC_COMPLETE", occurredAt: at })).toBe(false);
    expect(ruleApplies(rule(), { type: "FIRST_FUNDING", occurredAt: at })).toBe(false);
  });
  it("honours the validity window on the event time, both ends inclusive", () => {
    const r = rule({ validFrom: new Date("2027-01-15T10:00:00Z"), validTo: new Date("2027-01-20T00:00:00Z") });
    expect(ruleApplies(r, { type: "KYC_COMPLETE", occurredAt: at })).toBe(true);
    expect(ruleApplies(r, { type: "KYC_COMPLETE", occurredAt: new Date("2027-01-14T00:00:00Z") })).toBe(false);
    expect(ruleApplies(r, { type: "KYC_COMPLETE", occurredAt: new Date("2027-01-21T00:00:00Z") })).toBe(false);
  });
});

describe("computeReward", () => {
  it("fixed amount", () => {
    expect(computeReward(rule(), { eventAmountPaise: 0, accruedThisMonthPaise: 0 })).toEqual({ amountPaise: 10000, capped: false });
  });
  it("percent of the funded amount, rounded down to the paisa", () => {
    const r = rule({ event: "FIRST_FUNDING", kind: "PERCENT", fixedPaise: null, percentBps: 150 });
    expect(computeReward(r, { eventAmountPaise: 1_000_033, accruedThisMonthPaise: 0 }).amountPaise).toBe(15_000);
  });
  it("percent respects the per-reward maximum", () => {
    const r = rule({ kind: "PERCENT", fixedPaise: null, percentBps: 1000, maxRewardPaise: 5000 });
    expect(computeReward(r, { eventAmountPaise: 1_000_000, accruedThisMonthPaise: 0 })).toEqual({ amountPaise: 5000, capped: true });
  });
  it("the monthly cap trims the reward to what is left and says so", () => {
    const r = rule({ capPerReferrerMonthPaise: 25000 });
    expect(computeReward(r, { eventAmountPaise: 0, accruedThisMonthPaise: 20000 })).toEqual({ amountPaise: 5000, capped: true });
    expect(computeReward(r, { eventAmountPaise: 0, accruedThisMonthPaise: 25000 })).toEqual({ amountPaise: 0, capped: true });
    expect(computeReward(r, { eventAmountPaise: 0, accruedThisMonthPaise: 15000 })).toEqual({ amountPaise: 10000, capped: false });
  });
  it("a malformed rule pays nothing", () => {
    expect(computeReward(rule({ fixedPaise: null }), { eventAmountPaise: 0, accruedThisMonthPaise: 0 }).amountPaise).toBe(0);
    expect(computeReward(rule({ fixedPaise: -5 }), { eventAmountPaise: 0, accruedThisMonthPaise: 0 }).amountPaise).toBe(0);
  });
});

describe("monthKeyIST", () => {
  it("uses India time for the calendar month", () => {
    expect(monthKeyIST(new Date("2027-01-31T19:00:00Z"))).toBe("2027-02");
    expect(monthKeyIST(new Date("2027-01-31T17:00:00Z"))).toBe("2027-01");
  });
});

describe("validateRuleInput", () => {
  const good = { name: "KYC bonus", event: "KYC_COMPLETE", kind: "FIXED", amountRupees: "100", maxRewardRupees: "", capPerMonthRupees: "", validFrom: "", validTo: "" };
  it("accepts a fixed rule and converts to paise", () => {
    const r = validateRuleInput(good);
    expect(r).toMatchObject({ ok: true, value: { fixedPaise: 10000, percentBps: null, capPerReferrerMonthPaise: null } });
  });
  it("accepts a percent rule only on funding, in basis points", () => {
    expect(validateRuleInput({ ...good, event: "FIRST_FUNDING", kind: "PERCENT", amountRupees: "1.25" })).toMatchObject({ ok: true, value: { percentBps: 125, fixedPaise: null } });
    expect(validateRuleInput({ ...good, kind: "PERCENT", amountRupees: "1" }).ok).toBe(false);
  });
  it("rejects nonsense", () => {
    expect(validateRuleInput({ ...good, name: "" }).ok).toBe(false);
    expect(validateRuleInput({ ...good, amountRupees: "-1" }).ok).toBe(false);
    expect(validateRuleInput({ ...good, amountRupees: "abc" }).ok).toBe(false);
    expect(validateRuleInput({ ...good, event: "SIGNED_UP_X" }).ok).toBe(false);
    expect(validateRuleInput({ ...good, kind: "PERCENT", event: "FIRST_FUNDING", amountRupees: "150" }).ok).toBe(false);
    expect(validateRuleInput({ ...good, validFrom: "2027-02-01", validTo: "2027-01-01" }).ok).toBe(false);
  });
});
