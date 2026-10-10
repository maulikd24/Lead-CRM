import { describe, expect, it } from "vitest";

import { parseUnits } from "../native/money";
import { applyTax, ROUNDING_RULE, TAX_NOTE } from "./compute";
import type { TaxRule } from "./rules";

const rule = (over: Partial<TaxRule>): TaxRule => ({
  id: "r1",
  kind: "TDS",
  label: "Section X",
  ratePercent: "10",
  thresholdAmount: null,
  partnerTypes: [],
  panStatus: "ANY",
  gstRegistration: "ANY",
  gstMode: null,
  effectiveFrom: "2026-04-01T00:00:00.000Z",
  effectiveTo: null,
  ...over,
});
const facts = { partnerType: "PARTNER", hasPan: true, hasGstin: true };
const at = new Date("2026-09-30T00:00:00.000Z");
const u = (s: string) => parseUnits(s);
const run = (rules: TaxRule[], base: string, prior = "0", f = facts) => applyTax({ rules, facts: f, at, baseUnits: u(base), priorUnits: u(prior) });

describe("applyTax: nothing is deducted until rules are configured", () => {
  it("with no rules at all the state says so and the effect is zero", () => {
    const t = run([], "100000");
    expect(t.state).toBe("not_configured");
    expect(t.lines).toEqual([]);
    expect(t.effectPaise).toBe(BigInt(0));
  });
  it("with rules that do not cover this partner the state says no rule applies", () => {
    const t = run([rule({ partnerTypes: ["DISTRIBUTOR"] })], "100000");
    expect(t.state).toBe("no_match");
    expect(t.effectPaise).toBe(BigInt(0));
    expect(t.lines).toEqual([]);
  });
  it("a conflict deducts nothing and names the rules", () => {
    const t = run([rule({ id: "a" }), rule({ id: "b", ratePercent: "5" })], "100000");
    expect(t.state).toBe("conflict");
    expect(t.effectPaise).toBe(BigInt(0));
    expect(t.conflicts).toEqual([{ kind: "TDS", ruleIds: ["a", "b"] }]);
  });
});

describe("TDS", () => {
  it("is the rate on the base when there is no threshold", () => {
    const t = run([rule({})], "1000");
    expect(t.state).toBe("applied");
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]).toMatchObject({ kind: "TDS", label: "Section X", memo: false, amountPaise: BigInt(10000), effectPaise: -BigInt(10000), rate: "10%" });
    expect(t.effectPaise).toBe(-BigInt(10000));
  });
  it("deducts nothing while the financial year's running total is at or under the threshold", () => {
    const t = run([rule({ thresholdAmount: "20000" })], "5000", "15000"); // running total exactly 20,000
    expect(t.lines[0].amountPaise).toBe(BigInt(0));
    expect(t.lines[0].thresholdPassed).toBe(false);
  });
  it("once the running total passes the threshold, tax applies to the whole running total and this statement carries the catch-up", () => {
    const t = run([rule({ thresholdAmount: "20000" })], "5000.01", "15000"); // running total 20,000.01
    expect(t.lines[0].thresholdPassed).toBe(true);
    expect(t.lines[0].amountPaise).toBe(BigInt(200000)); // 10% of 20,000.01 = 2,000.001 -> 2,000.00
    const next = run([rule({ thresholdAmount: "20000" })], "1000", "20000.01");
    expect(next.lines[0].amountPaise).toBe(BigInt(10000)); // 10% of 1,000, exactly the new tail
  });
  it("statements that follow each other add up to the tax on the year's total, to the paisa", () => {
    const r = [rule({ ratePercent: "3.75", thresholdAmount: "100" })];
    const parts = ["33.33", "33.33", "33.34", "17.77", "99.99"];
    let prior = BigInt(0);
    let sum = BigInt(0);
    for (const p of parts) {
      const t = applyTax({ rules: r, facts, at, baseUnits: u(p), priorUnits: prior });
      sum += t.lines[0].amountPaise;
      prior += u(p);
    }
    const whole = applyTax({ rules: r, facts, at, baseUnits: prior, priorUnits: BigInt(0) });
    expect(sum).toBe(whole.lines[0].amountPaise);
  });
  it("a clawback that drops the year back under the threshold gives the tax back (a credit)", () => {
    const t = run([rule({ thresholdAmount: "1000" })], "-600", "1200"); // 1,200 -> 600
    expect(t.lines[0].amountPaise).toBe(-BigInt(12000));
    expect(t.lines[0].effectPaise).toBe(BigInt(12000));
  });
  it("tax on a negative running total is zero", () => {
    const t = run([rule({})], "-500", "0");
    expect(t.lines[0].amountPaise).toBe(BigInt(0));
  });
  it("shows the exact rule used and the rounding rule", () => {
    const t = run([rule({ thresholdAmount: "20000", partnerTypes: ["PARTNER"] })], "30000");
    expect(t.lines[0].ruleText).toContain("Section X");
    expect(t.lines[0].ruleText).toContain("10%");
    expect(ROUNDING_RULE).toMatch(/nearest paisa/i);
    expect(ROUNDING_RULE).toMatch(/half|away from zero/i);
    expect(TAX_NOTE).toBe("Tax rules are configured by Finance. Confirm with your tax adviser.");
  });
});

describe("GST", () => {
  const g = (mode: TaxRule["gstMode"], extra: Partial<TaxRule> = {}) => rule({ id: "g", kind: "GST", label: "GST", ratePercent: "18", gstMode: mode, ...extra });
  it("reverse charge is shown but never changes the net", () => {
    const t = run([g("REVERSE_CHARGE")], "1000");
    expect(t.lines[0]).toMatchObject({ kind: "GST", memo: true, amountPaise: BigInt(18000), effectPaise: BigInt(0) });
    expect(t.effectPaise).toBe(BigInt(0));
  });
  it("self-invoice is shown but never changes the net", () => {
    const t = run([g("SELF_INVOICE")], "1000");
    expect(t.lines[0]).toMatchObject({ memo: true, effectPaise: BigInt(0) });
  });
  it("the partner's own invoice adds the tax to the payable", () => {
    const t = run([g("PARTNER_INVOICED")], "1000");
    expect(t.lines[0]).toMatchObject({ memo: false, amountPaise: BigInt(18000), effectPaise: BigInt(18000) });
    expect(t.effectPaise).toBe(BigInt(18000));
  });
  it("is chosen by registration: a registered and an unregistered rule never both apply", () => {
    const rules = [g("PARTNER_INVOICED", { id: "reg", gstRegistration: "REGISTERED" }), g("REVERSE_CHARGE", { id: "unreg", gstRegistration: "UNREGISTERED" })];
    expect(run(rules, "1000", "0", { ...facts, hasGstin: true }).lines[0].ruleId).toBe("reg");
    expect(run(rules, "1000", "0", { ...facts, hasGstin: false }).lines[0].ruleId).toBe("unreg");
  });
  it("charges no GST on a zero or negative base", () => {
    expect(run([g("PARTNER_INVOICED")], "-100").lines[0].amountPaise).toBe(BigInt(0));
  });
});

describe("TDS and GST together", () => {
  it("both lines appear, the net effect is GST added (if the partner invoices) minus TDS", () => {
    const t = run([rule({}), rule({ id: "g", kind: "GST", label: "GST", ratePercent: "18", gstMode: "PARTNER_INVOICED" })], "1000");
    expect(t.lines.map((l) => l.kind)).toEqual(["TDS", "GST"]);
    expect(t.effectPaise).toBe(BigInt(18000) - BigInt(10000));
  });
  it("if only one kind has a rule the other kind is reported as not applying, not as zero tax", () => {
    const t = run([rule({})], "1000");
    expect(t.missing).toEqual(["GST"]);
  });
});
