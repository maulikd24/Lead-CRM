import { describe, expect, it } from "vitest";

import type { TaxRule } from "../tax/rules";
import { buildCumulativeStatement, buildStatement, type StatementInput } from "./statement";

const line = (id: string, amount: string, date = "2026-09-05T00:00:00.000Z") => ({ id, date, revenueType: "BROKERAGE", clientCode: "CL-00001", amount });
const adj = (id: string, amount: string, reason = "Clawback") => ({ id, date: "2026-09-20T00:00:00.000Z", reason, amount });

describe("buildStatement", () => {
  it("totals lines, adjustments and net payable to the paisa", () => {
    const s = buildStatement({ lines: [line("a", "100.10"), line("b", "200.20")], adjustments: [adj("x", "-50.05")], stored: null });
    expect(s.grossPaise).toBe(BigInt(30030));
    expect(s.adjustmentsPaise).toBe(-BigInt(5005));
    expect(s.netPaise).toBe(BigInt(25025));
    expect(s.gross).toBe("300.30");
    expect(s.net).toBe("250.25");
  });

  it("rounds the total once, on exact figures, and shows the rounding as its own line", () => {
    // three accruals of 0.004 each: every line rounds to 0.00, but the exact total 0.012 is 0.01.
    const s = buildStatement({ lines: [line("a", "0.004"), line("b", "0.004"), line("c", "0.004")], adjustments: [], stored: null });
    expect(s.lines.map((l) => l.amount)).toEqual(["0.00", "0.00", "0.00"]);
    expect(s.grossPaise).toBe(BigInt(1));
    expect(s.roundingPaise).toBe(BigInt(1));
    // the shown lines plus the rounding line always equal the total
    expect(s.lines.reduce((a, l) => a + l.amountPaise, BigInt(0)) + s.roundingPaise).toBe(s.grossPaise);
  });

  it("has a zero rounding line when the amounts are already in paise", () => {
    const s = buildStatement({ lines: [line("a", "10.01"), line("b", "20.02")], adjustments: [], stored: null });
    expect(s.roundingPaise).toBe(BigInt(0));
  });

  it("a statement with nothing on it is all zeros, not an error", () => {
    const s = buildStatement({ lines: [], adjustments: [], stored: null });
    expect([s.gross, s.adjustmentsTotal, s.net]).toEqual(["0.00", "0.00", "0.00"]);
  });

  it("does not hide a negative net: clawbacks can exceed accruals", () => {
    const s = buildStatement({ lines: [line("a", "10.00")], adjustments: [adj("x", "-25.00")], stored: null });
    expect(s.netPaise).toBe(-BigInt(1500));
    expect(s.negativeNet).toBe(true);
  });

  it("agrees with the stored payout when it matches to the paisa", () => {
    const s = buildStatement({ lines: [line("a", "100.004"), line("b", "50.004")], adjustments: [adj("x", "-10")], stored: { totalAccrual: "150.008", adjustment: "-10", net: "140.008" } });
    expect(s.stored).toEqual({ matches: true, net: "140.01", gross: "150.01", adjustments: "-10.00" });
  });

  it("reports a stored payout that disagrees, with both figures", () => {
    const s = buildStatement({ lines: [line("a", "100")], adjustments: [], stored: { totalAccrual: "90", adjustment: "0", net: "90" } });
    expect(s.stored!.matches).toBe(false);
    expect(s.stored!.net).toBe("90.00");
    expect(s.net).toBe("100.00");
  });

  it("orders lines by date then id so the same data always prints the same", () => {
    const s = buildStatement({ lines: [line("b", "1", "2026-09-06T00:00:00.000Z"), line("a", "1", "2026-09-06T00:00:00.000Z"), line("c", "1", "2026-09-01T00:00:00.000Z")], adjustments: [], stored: null });
    expect(s.lines.map((l) => l.id)).toEqual(["c", "a", "b"]);
  });

  it("with no tax rules it says so plainly and deducts nothing", () => {
    const s = buildStatement({ lines: [line("a", "100")], adjustments: [], stored: null });
    expect(s.tax.state).toBe("not_configured");
    expect(s.tax.lines).toEqual([]);
    expect(s.payablePaise).toBe(s.netPaise);
    expect(s.payable).toBe("100.00");
    expect(s.assumptions.join(" ")).toMatch(/no tax rules (are )?configured/i);
    expect(s.assumptions.join(" ")).toMatch(/TDS/);
    expect(s.assumptions.join(" ")).toMatch(/GST/);
  });

  it("is a pure function of its input", () => {
    const input: StatementInput = { lines: [line("a", "1.005")], adjustments: [], stored: null };
    expect(buildStatement(input)).toEqual(buildStatement(input));
  });

  it("throws on an amount that is not a number rather than counting it as zero", () => {
    expect(() => buildStatement({ lines: [line("a", "oops")], adjustments: [], stored: null })).toThrow();
  });
});


const tdsRule = (over: Partial<TaxRule> = {}): TaxRule => ({ id: "t1", kind: "TDS", label: "Section X", ratePercent: "10", thresholdAmount: "1000", partnerTypes: [], panStatus: "ANY", gstRegistration: "ANY", gstMode: null, effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null, ...over });
const gstRule = (mode: TaxRule["gstMode"]): TaxRule => tdsRule({ id: "g1", kind: "GST", label: "GST", ratePercent: "18", thresholdAmount: null, gstMode: mode });
const tax = (rules: TaxRule[], priorBase = "0") => ({ rules, facts: { partnerType: "PARTNER", hasPan: true, hasGstin: true }, at: "2026-09-30T00:00:00.000Z", priorBase });

describe("buildStatement with tax", () => {
  it("shows each tax line with the exact rule, and the payable after tax", () => {
    const s = buildStatement({ lines: [line("a", "2000")], adjustments: [], stored: null, tax: tax([tdsRule()]) });
    expect(s.net).toBe("2000.00");
    expect(s.tax.state).toBe("applied");
    expect(s.tax.lines).toHaveLength(1);
    expect(s.tax.lines[0]).toMatchObject({ kind: "TDS", label: "Section X", rate: "10%", amount: "200.00", effect: "-200.00", memo: false });
    expect(s.tax.lines[0].ruleText).toContain("Section X");
    expect(s.payable).toBe("1800.00");
    expect(s.payablePaise).toBe(BigInt(180000));
    expect(s.tax.note).toBe("Tax rules are configured by Finance. Confirm with your tax adviser.");
    expect(s.tax.rounding).toMatch(/nearest paisa/i);
  });
  it("takes the earlier statements of the financial year into account", () => {
    // 500 earned before, 600 now: running total 1,100 passes the 1,000 threshold, so 10% of 1,100 is due now.
    const s = buildStatement({ lines: [line("a", "600")], adjustments: [], stored: null, tax: tax([tdsRule()], "500") });
    expect(s.tax.lines[0].amount).toBe("110.00");
    expect(s.payable).toBe("490.00");
  });
  it("tax is taken on the net after adjustments", () => {
    const s = buildStatement({ lines: [line("a", "2000")], adjustments: [adj("x", "-500")], stored: null, tax: tax([tdsRule()]) });
    expect(s.tax.lines[0]).toMatchObject({ amount: "150.00" });
    expect(s.payable).toBe("1350.00");
  });
  it("a partner-invoiced GST adds to the payable; reverse charge is shown but not added", () => {
    const added = buildStatement({ lines: [line("a", "1000")], adjustments: [], stored: null, tax: tax([gstRule("PARTNER_INVOICED")]) });
    expect(added.payable).toBe("1180.00");
    const memo = buildStatement({ lines: [line("a", "1000")], adjustments: [], stored: null, tax: tax([gstRule("REVERSE_CHARGE")]) });
    expect(memo.tax.lines[0]).toMatchObject({ memo: true, amount: "180.00", effect: "0.00" });
    expect(memo.payable).toBe("1000.00");
  });
  it("rules that do not cover the partner say so, they are not read as zero tax", () => {
    const s = buildStatement({ lines: [line("a", "1000")], adjustments: [], stored: null, tax: tax([tdsRule({ partnerTypes: ["DISTRIBUTOR"] })]) });
    expect(s.tax.state).toBe("no_match");
    expect(s.payable).toBe("1000.00");
  });
  it("a conflict between two rules deducts nothing and names them", () => {
    const s = buildStatement({ lines: [line("a", "1000")], adjustments: [], stored: null, tax: tax([tdsRule({ id: "a" }), tdsRule({ id: "b" })]) });
    expect(s.tax.state).toBe("conflict");
    expect(s.tax.conflicts).toEqual([{ kind: "TDS", ruleIds: ["a", "b"] }]);
    expect(s.payable).toBe("1000.00");
  });
  it("the check against the stored payout is still about the figure before tax", () => {
    const s = buildStatement({ lines: [line("a", "2000")], adjustments: [], stored: { totalAccrual: "2000", adjustment: "0", net: "2000" }, tax: tax([tdsRule()]) });
    expect(s.stored?.matches).toBe(true);
  });
});

describe("buildCumulativeStatement: the financial year to date, month by month", () => {
  const months = [
    { key: "2026-04", accruals: "400", adjustments: "0" },
    { key: "2026-05", accruals: "400", adjustments: "0" },
    { key: "2026-06", accruals: "400", adjustments: "-50" },
    { key: "2026-07", accruals: "0", adjustments: "0" },
  ];
  it("keeps a running total and carries the tax difference month by month", () => {
    const c = buildCumulativeStatement({ months, priorBase: "0", tax: { rules: [tdsRule()], facts: { partnerType: "PARTNER", hasPan: true, hasGstin: false } } });
    expect(c.rows.map((r) => r.base)).toEqual(["400.00", "400.00", "350.00", "0.00"]);
    expect(c.rows.map((r) => r.running)).toEqual(["400.00", "800.00", "1150.00", "1150.00"]);
    // threshold 1,000 is passed in June: 10% of 1,150 = 115.00 in that month, nothing before or after.
    expect(c.rows.map((r) => r.tds)).toEqual(["0.00", "0.00", "115.00", "0.00"]);
    expect(c.totals).toMatchObject({ base: "1150.00", tds: "115.00" });
  });
  it("the months add up to the tax on the whole year, to the paisa", () => {
    const m = ["33.33", "33.33", "33.34", "17.77", "99.99"].map((a, i) => ({ key: `2026-0${i + 4}`, accruals: a, adjustments: "0" }));
    const rules = [tdsRule({ ratePercent: "3.75", thresholdAmount: "100" })];
    const c = buildCumulativeStatement({ months: m, priorBase: "0", tax: { rules, facts: { partnerType: "PARTNER", hasPan: true, hasGstin: false } } });
    const whole = buildStatement({ lines: [line("a", "217.76")], adjustments: [], stored: null, tax: tax(rules) });
    expect(c.totals.tds).toBe(whole.tax.lines[0].amount);
  });
  it("with no rules it has no tax column values and says so", () => {
    const c = buildCumulativeStatement({ months, priorBase: "0", tax: { rules: [], facts: { partnerType: "PARTNER", hasPan: true, hasGstin: false } } });
    expect(c.taxState).toBe("not_configured");
    expect(c.rows.every((r) => r.tds === "0.00")).toBe(true);
  });
});
