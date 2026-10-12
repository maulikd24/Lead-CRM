import { describe, expect, it } from "vitest";

import { describeOverrideRule, findOverrideOverlap, planOverrideRuleChange, validateOverrideRule, type OverrideRule } from "./rules";

const rule = (over: Partial<OverrideRule> = {}): OverrideRule => ({ id: "o1", level: 1, ratePercent: "5", capPerAccrual: "500", effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null, ...over });
const ok = { level: "1", ratePercent: "5", capPerAccrual: "500", effectiveFrom: "2026-04-01" };

describe("validateOverrideRule: nothing is defaulted", () => {
  it("accepts a complete rule and normalises it", () => {
    const r = validateOverrideRule(ok);
    expect(r).toMatchObject({ ok: true, rule: { level: 1, ratePercent: "5", capPerAccrual: "500", effectiveTo: null } });
  });
  it("needs a level between 1 and 5, as a whole number", () => {
    for (const bad of ["0", "6", "1.5", "", "x", undefined]) expect(validateOverrideRule({ ...ok, level: bad }).ok, String(bad)).toBe(false);
    expect(validateOverrideRule({ ...ok, level: 3 }).ok).toBe(true);
  });
  it("needs a rate above zero and up to 100 with at most four decimals; there is no default", () => {
    for (const bad of ["", "0", "-1", "100.1", "1.00001", "abc", undefined]) expect(validateOverrideRule({ ...ok, ratePercent: bad }).ok, String(bad)).toBe(false);
    expect(validateOverrideRule({ ...ok, ratePercent: "100" }).ok).toBe(true);
  });
  it("a cap is optional, positive, with at most two decimals", () => {
    expect(validateOverrideRule({ ...ok, capPerAccrual: "" })).toMatchObject({ ok: true, rule: { capPerAccrual: null } });
    for (const bad of ["0", "-5", "1.234", "abc"]) expect(validateOverrideRule({ ...ok, capPerAccrual: bad }).ok, bad).toBe(false);
  });
  it("needs a start date and an end date after it", () => {
    expect(validateOverrideRule({ ...ok, effectiveFrom: "" }).ok).toBe(false);
    expect(validateOverrideRule({ ...ok, effectiveTo: "2026-04-01" }).ok).toBe(false);
    expect(validateOverrideRule({ ...ok, effectiveTo: "2027-03-31" }).ok).toBe(true);
  });
});

describe("findOverrideOverlap: one rule per level at a time", () => {
  it("flags the same level with overlapping dates", () => {
    expect(findOverrideOverlap([rule({ id: "a" })], rule({ id: "n", effectiveFrom: "2026-08-01T00:00:00.000Z" }))).toBe("a");
  });
  it("allows other levels, disjoint dates and the rule being replaced", () => {
    expect(findOverrideOverlap([rule({ id: "a" })], rule({ id: "n", level: 2 }))).toBeNull();
    expect(findOverrideOverlap([rule({ id: "a", effectiveTo: "2026-07-01T00:00:00.000Z" })], rule({ id: "n", effectiveFrom: "2026-07-01T00:00:00.000Z" }))).toBeNull();
    expect(findOverrideOverlap([rule({ id: "a" })], rule({ id: "n" }), "a")).toBeNull();
  });
});

describe("describeOverrideRule", () => {
  it("says level, rate, cap and dates", () => {
    const t = describeOverrideRule(rule());
    expect(t).toContain("level 1");
    expect(t).toContain("5%");
    expect(t).toContain("500");
    expect(t).toContain("1 Apr 2026");
    expect(describeOverrideRule(rule({ capPerAccrual: null }))).toMatch(/no cap/i);
  });
});

describe("planOverrideRuleChange", () => {
  const now = new Date("2026-10-10T06:00:00.000Z");
  it("creates, replaces and retires with the same history rules as tax rules", () => {
    expect(planOverrideRuleChange({ op: "create", rule: { ...ok, effectiveFrom: "2026-11-01" } }, [], now).ok).toBe(true);
    const rep = planOverrideRuleChange({ op: "replace", ruleId: "o1", rule: { ...ok, ratePercent: "4", effectiveFrom: "2026-11-01" } }, [rule()], now);
    expect(rep.ok).toBe(true);
    if (rep.ok) expect(rep.writes[0]).toEqual({ type: "end", id: "o1", effectiveTo: "2026-10-31T18:30:00.000Z" });
    expect(planOverrideRuleChange({ op: "retire", ruleId: "o1", effectiveTo: "2026-09-01" }, [rule()], now).ok).toBe(false);
    expect(planOverrideRuleChange({ op: "create", rule: { ...ok, effectiveFrom: "2026-08-01" } }, [rule()], now).ok).toBe(false);
  });
});
