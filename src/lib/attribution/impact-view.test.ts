import { describe, expect, it } from "vitest";

import { deltaLabel, previousRange, sortImpactRows } from "./impact-view";
import type { ImpactRow } from "./impact";

const row = (over: Partial<ImpactRow>): ImpactRow => ({
  key: "k", label: "L", kind: "campaign", channel: "meta", spend: 0, spendKnown: true, leads: 0, contactedInSla: 0, contactedInSlaRate: null, late: 0, missed: 0, kyc: 0, kycRate: null, funded: 0, fundedRate: null, revenue: 0,
  cpl: null, costPerFunded: null, roas: null, paybackMonths: null, recoveredPct: null, creatives: [], cohorts: [], confidence: { high: 0, medium: 0, low: 0 }, ...over,
});

describe("sortImpactRows", () => {
  const rows = [row({ key: "a", label: "Alpha", cpl: 300, roas: 2 }), row({ key: "b", label: "Beta", cpl: null, roas: 5 }), row({ key: "c", label: "Gamma", cpl: 100, roas: null })];
  it("sorts by a number, either way, with unknown values always last", () => {
    expect(sortImpactRows(rows, "cpl", "asc").map((r) => r.key)).toEqual(["c", "a", "b"]);
    expect(sortImpactRows(rows, "cpl", "desc").map((r) => r.key)).toEqual(["a", "c", "b"]);
    expect(sortImpactRows(rows, "roas", "desc").map((r) => r.key)).toEqual(["b", "a", "c"]);
  });
  it("sorts by name, and does not change the input", () => {
    expect(sortImpactRows(rows, "label", "asc").map((r) => r.key)).toEqual(["a", "b", "c"]);
    expect(sortImpactRows(rows, "label", "desc").map((r) => r.key)).toEqual(["c", "b", "a"]);
    expect(rows.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
});

describe("previousRange: the period of the same length that ends the day before", () => {
  it("30 days", () => {
    expect(previousRange({ from: "2027-04-01", to: "2027-04-30" })).toEqual({ from: "2027-03-02", to: "2027-03-31" });
  });
  it("a single day", () => {
    expect(previousRange({ from: "2027-04-10", to: "2027-04-10" })).toEqual({ from: "2027-04-09", to: "2027-04-09" });
  });
});

describe("deltaLabel", () => {
  it("says how much a figure moved, and says nothing when it cannot be known", () => {
    expect(deltaLabel({ value: 12, prev: 10, change: 0.2 })).toEqual({ text: "+20% vs previous", direction: "up" });
    expect(deltaLabel({ value: 8, prev: 10, change: -0.2 })).toEqual({ text: "-20% vs previous", direction: "down" });
    expect(deltaLabel({ value: 10, prev: 10, change: 0 })).toEqual({ text: "No change vs previous", direction: "flat" });
    expect(deltaLabel({ value: 3, prev: 0, change: null })).toEqual({ text: "No previous figure to compare", direction: "none" });
    expect(deltaLabel({ value: null, prev: 4, change: null })).toEqual({ text: "No figure this period", direction: "none" });
  });
});
