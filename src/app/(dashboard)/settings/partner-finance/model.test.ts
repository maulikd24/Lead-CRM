import { describe, expect, it } from "vitest";

import type { OverrideRule } from "@/lib/partners/overrides/rules";
import type { TaxRule } from "@/lib/partners/tax/rules";
import { buildPendingRows, overrideRuleRows, ruleStatus, taxRuleRows, PARTNER_FINANCE_TABS, parseFinanceTab } from "./model";

const now = new Date("2026-10-10T06:00:00.000Z");
const tax = (o: Partial<TaxRule> = {}): TaxRule => ({ id: "t1", kind: "TDS", label: "Section X", ratePercent: "10", thresholdAmount: "20000", partnerTypes: ["PARTNER"], panStatus: "PRESENT", gstRegistration: "ANY", gstMode: null, effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null, ...o });
const ov = (o: Partial<OverrideRule> = {}): OverrideRule => ({ id: "o1", level: 1, ratePercent: "5", capPerAccrual: "500", effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null, ...o });

describe("ruleStatus", () => {
  it("is Active, Scheduled or Ended by the dates, with the end exclusive", () => {
    expect(ruleStatus(tax(), now)).toBe("Active");
    expect(ruleStatus(tax({ effectiveFrom: "2026-11-01T00:00:00.000Z" }), now)).toBe("Scheduled");
    expect(ruleStatus(tax({ effectiveTo: "2026-10-10T06:00:00.000Z" }), now)).toBe("Ended");
    expect(ruleStatus(tax({ effectiveTo: "2026-10-10T06:00:01.000Z" }), now)).toBe("Active");
  });
});

describe("taxRuleRows", () => {
  it("shows kind, label, rate, threshold, reach, dates and the exact rule text, active first", () => {
    const rows = taxRuleRows([tax({ id: "old", effectiveTo: "2026-06-01T00:00:00.000Z" }), tax({ id: "gst", kind: "GST", label: "GST", ratePercent: "18", thresholdAmount: null, gstMode: "REVERSE_CHARGE", partnerTypes: [], panStatus: "ANY", gstRegistration: "UNREGISTERED" }), tax()], now);
    expect(rows.map((r) => [r.id, r.status])).toEqual([["gst", "Active"], ["t1", "Active"], ["old", "Ended"]]);
    const t = rows.find((r) => r.id === "t1")!;
    expect(t).toMatchObject({ kind: "TDS", label: "Section X", rate: "10%", threshold: "₹20,000", reach: "Partner, with a PAN on file", from: "1 Apr 2026", to: "No end date", canChange: true });
    expect(t.text).toContain("Section X");
    const g = rows.find((r) => r.id === "gst")!;
    expect(g).toMatchObject({ threshold: "None", reach: "Every partner type, not GST registered", kind: "GST" });
  });
  it("an ended rule cannot be replaced or ended again", () => {
    expect(taxRuleRows([tax({ effectiveTo: "2026-06-01T00:00:00.000Z" })], now)[0].canChange).toBe(false);
  });
  it("no rules means no rows, not made-up ones", () => {
    expect(taxRuleRows([], now)).toEqual([]);
  });
});

describe("overrideRuleRows", () => {
  it("shows the level, rate, cap and dates", () => {
    expect(overrideRuleRows([ov(), ov({ id: "o2", level: 2, capPerAccrual: null })], now).map((r) => [r.id, r.level, r.rate, r.cap])).toEqual([["o1", 1, "5%", "₹500"], ["o2", 2, "5%", "No cap"]]);
  });
});

describe("buildPendingRows: waiting for a second person", () => {
  const req = (o: object = {}) => ({ id: "r1", actionType: "PARTNER_TAX_RULE_CHANGE", reason: "Add tax rule: Section X: 5%", requestedAt: new Date("2026-10-09T05:00:00.000Z"), requestedById: "u-maker", requestedBy: { name: "Maker Name" }, ...o });
  it("names the proposal, who made it and when, and who may decide", () => {
    const rows = buildPendingRows([req()], "u-checker");
    expect(rows[0]).toMatchObject({ id: "r1", kind: "Tax rule", summary: "Add tax rule: Section X: 5%", by: "Maker Name", canDecide: true });
    expect(rows[0].when).toContain("9 Oct 2026");
  });
  it("the person who proposed it cannot decide it, and the row says why", () => {
    const rows = buildPendingRows([req()], "u-maker");
    expect(rows[0].canDecide).toBe(false);
    expect(rows[0].blockedReason).toBe("A different person has to approve this. You proposed it.");
  });
  it("labels override changes too", () => {
    expect(buildPendingRows([req({ actionType: "PARTNER_OVERRIDE_RULE_CHANGE" })], "x")[0].kind).toBe("Override rule");
  });
});

describe("tabs", () => {
  it("lists the sections and falls back to the first", () => {
    expect(PARTNER_FINANCE_TABS.map((t) => t.key)).toEqual(["tax", "overrides", "statements", "referrals", "approve"]);
    expect(parseFinanceTab("overrides")).toBe("overrides");
    expect(parseFinanceTab("x")).toBe("tax");
    expect(parseFinanceTab(undefined)).toBe("tax");
  });
});
