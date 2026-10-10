import { describe, expect, it } from "vitest";

import { describeRule, findOverlap, pickRule, validateTaxRule, type TaxRule } from "./rules";

const tds = (over: Partial<TaxRule> = {}): TaxRule => ({
  id: "r1",
  kind: "TDS",
  label: "Section X",
  ratePercent: "10",
  thresholdAmount: "20000",
  partnerTypes: [],
  panStatus: "ANY",
  gstRegistration: "ANY",
  gstMode: null,
  effectiveFrom: "2026-04-01T00:00:00.000Z",
  effectiveTo: null,
  ...over,
});
const gst = (over: Partial<TaxRule> = {}): TaxRule => tds({ id: "g1", kind: "GST", label: "GST", ratePercent: "18", thresholdAmount: null, gstMode: "REVERSE_CHARGE", ...over });
const facts = { partnerType: "PARTNER", hasPan: true, hasGstin: false };
const at = new Date("2026-09-30T00:00:00.000Z");

describe("validateTaxRule: nothing is guessed, nothing is defaulted", () => {
  const ok = { kind: "TDS", label: "Section X", ratePercent: "10", thresholdAmount: "20000", partnerTypes: ["PARTNER"], panStatus: "PRESENT", effectiveFrom: "2026-04-01" };
  it("accepts a complete TDS rule and normalises it", () => {
    const r = validateTaxRule(ok);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rule).toMatchObject({ kind: "TDS", label: "Section X", ratePercent: "10", thresholdAmount: "20000", partnerTypes: ["PARTNER"], panStatus: "PRESENT", gstRegistration: "ANY", gstMode: null, effectiveTo: null });
  });
  it("a missing or blank rate is refused, never defaulted", () => {
    for (const bad of [undefined, "", "  ", "abc", "-5", "1.00001", "101"]) expect(validateTaxRule({ ...ok, ratePercent: bad }).ok, String(bad)).toBe(false);
  });
  it("needs a label, a known kind and a real start date", () => {
    expect(validateTaxRule({ ...ok, label: "  " }).ok).toBe(false);
    expect(validateTaxRule({ ...ok, label: "x".repeat(81) }).ok).toBe(false);
    expect(validateTaxRule({ ...ok, kind: "VAT" }).ok).toBe(false);
    expect(validateTaxRule({ ...ok, effectiveFrom: "tomorrow" }).ok).toBe(false);
    expect(validateTaxRule({ ...ok, effectiveFrom: undefined }).ok).toBe(false);
  });
  it("an end date must be after the start date", () => {
    expect(validateTaxRule({ ...ok, effectiveTo: "2026-04-01" }).ok).toBe(false);
    expect(validateTaxRule({ ...ok, effectiveTo: "2027-04-01" }).ok).toBe(true);
  });
  it("a threshold is a non-negative amount with at most two decimals; blank means none", () => {
    expect(validateTaxRule({ ...ok, thresholdAmount: "" })).toMatchObject({ ok: true, rule: { thresholdAmount: null } });
    for (const bad of ["-1", "10.001", "abc"]) expect(validateTaxRule({ ...ok, thresholdAmount: bad }).ok, bad).toBe(false);
  });
  it("only known partner types and statuses are accepted", () => {
    expect(validateTaxRule({ ...ok, partnerTypes: ["ROBOT"] }).ok).toBe(false);
    expect(validateTaxRule({ ...ok, panStatus: "MAYBE" }).ok).toBe(false);
  });
  it("a GST rule needs a mode and has no threshold; a TDS rule has no GST mode", () => {
    const g = { kind: "GST", label: "GST", ratePercent: "18", gstRegistration: "UNREGISTERED", gstMode: "REVERSE_CHARGE", effectiveFrom: "2026-04-01" };
    expect(validateTaxRule(g).ok).toBe(true);
    expect(validateTaxRule({ ...g, gstMode: undefined }).ok).toBe(false);
    expect(validateTaxRule({ ...g, gstMode: "BANANA" }).ok).toBe(false);
    expect(validateTaxRule({ ...g, thresholdAmount: "100" }).ok).toBe(false);
    expect(validateTaxRule({ ...ok, gstMode: "REVERSE_CHARGE" }).ok).toBe(false);
    expect(validateTaxRule({ ...ok, gstRegistration: "REGISTERED" }).ok).toBe(false);
  });
});

describe("pickRule: the one rule that applies, or an honest reason it does not", () => {
  it("is 'none' when nothing is configured", () => {
    expect(pickRule([], "TDS", facts, at)).toEqual({ status: "none" });
  });
  it("respects effective dates (start inclusive, end exclusive)", () => {
    const r = tds({ effectiveFrom: "2026-10-01T00:00:00.000Z" });
    expect(pickRule([r], "TDS", facts, at)).toEqual({ status: "none" });
    expect(pickRule([r], "TDS", facts, new Date("2026-10-01T00:00:00.000Z")).status).toBe("rule");
    const ended = tds({ effectiveTo: "2026-09-30T00:00:00.000Z" });
    expect(pickRule([ended], "TDS", facts, at)).toEqual({ status: "none" });
    expect(pickRule([ended], "TDS", facts, new Date("2026-09-29T23:59:59.000Z")).status).toBe("rule");
  });
  it("matches partner type and PAN status", () => {
    expect(pickRule([tds({ partnerTypes: ["DISTRIBUTOR"] })], "TDS", facts, at).status).toBe("none");
    expect(pickRule([tds({ partnerTypes: ["PARTNER", "AFFILIATE"] })], "TDS", facts, at).status).toBe("rule");
    expect(pickRule([tds({ panStatus: "ABSENT" })], "TDS", facts, at).status).toBe("none");
    expect(pickRule([tds({ panStatus: "ABSENT" })], "TDS", { ...facts, hasPan: false }, at).status).toBe("rule");
  });
  it("matches GST registration, and ignores rules of the other kind", () => {
    const g = gst({ gstRegistration: "REGISTERED" });
    expect(pickRule([g], "GST", facts, at).status).toBe("none");
    expect(pickRule([g], "GST", { ...facts, hasGstin: true }, at).status).toBe("rule");
    expect(pickRule([tds()], "GST", facts, at).status).toBe("none");
  });
  it("the more specific rule wins over a general one", () => {
    const general = tds({ id: "general" });
    const specific = tds({ id: "specific", partnerTypes: ["PARTNER"], panStatus: "PRESENT" });
    const r = pickRule([general, specific], "TDS", facts, at);
    expect(r).toMatchObject({ status: "rule", rule: { id: "specific" } });
  });
  it("two equally specific rules are a conflict, so nothing is deducted until Finance resolves it", () => {
    const r = pickRule([tds({ id: "a" }), tds({ id: "b", ratePercent: "5" })], "TDS", facts, at);
    expect(r).toEqual({ status: "conflict", ruleIds: ["a", "b"] });
  });
});

describe("findOverlap: Finance cannot save two rules that would collide", () => {
  it("flags an overlapping rule of the same kind and specificity that matches the same partners", () => {
    expect(findOverlap([tds({ id: "a" })], tds({ id: "new", effectiveFrom: "2026-08-01T00:00:00.000Z" }))).toBe("a");
  });
  it("does not flag disjoint dates, different kinds, different specificity or disjoint partner types", () => {
    expect(findOverlap([tds({ id: "a", effectiveTo: "2026-07-01T00:00:00.000Z" })], tds({ id: "n", effectiveFrom: "2026-07-01T00:00:00.000Z" }))).toBeNull();
    expect(findOverlap([gst({ id: "a" })], tds({ id: "n" }))).toBeNull();
    expect(findOverlap([tds({ id: "a" })], tds({ id: "n", panStatus: "PRESENT" }))).toBeNull();
    expect(findOverlap([tds({ id: "a", partnerTypes: ["PARTNER"] })], tds({ id: "n", partnerTypes: ["AFFILIATE"] }))).toBeNull();
  });
  it("ignores the rule being replaced", () => {
    expect(findOverlap([tds({ id: "a" })], tds({ id: "n" }), "a")).toBeNull();
  });
});

describe("describeRule: the exact rule, in words, for the statement", () => {
  it("says the label, the rate, the threshold, who it applies to and since when", () => {
    const text = describeRule(tds({ label: "Section X", ratePercent: "10", thresholdAmount: "20000", partnerTypes: ["PARTNER"], panStatus: "PRESENT" }));
    expect(text).toContain("Section X");
    expect(text).toContain("10%");
    expect(text).toContain("20,000");
    expect(text).toContain("financial year");
    expect(text).toMatch(/Partner/);
    expect(text).toMatch(/PAN/);
    expect(text).toContain("1 Apr 2026");
  });
  it("describes GST by mode", () => {
    expect(describeRule(gst({ gstMode: "REVERSE_CHARGE", gstRegistration: "UNREGISTERED" }))).toMatch(/reverse charge/i);
    expect(describeRule(gst({ gstMode: "SELF_INVOICE" }))).toMatch(/self-invoice/i);
    expect(describeRule(gst({ gstMode: "PARTNER_INVOICED" }))).toMatch(/partner.*invoice/i);
  });
  it("shows an end date when there is one and 'no threshold' when there is none", () => {
    expect(describeRule(tds({ thresholdAmount: null, effectiveTo: "2027-03-31T00:00:00.000Z" }))).toMatch(/no threshold/i);
    expect(describeRule(tds({ effectiveTo: "2027-03-31T00:00:00.000Z" }))).toContain("31 Mar 2027");
  });
});
