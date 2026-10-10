import { describe, expect, it } from "vitest";

import { buildAcceptanceChips, buildCallouts } from "./acceptance";

const rows = [
  { assetClass: "Mutual Funds", level: "HIGH" as const, source: "rule", reason: "Holds funds", isManual: false },
  { assetClass: "PMS", level: "LOW" as const, source: "manual", reason: "Declined twice", isManual: true },
  { assetClass: "AIF", level: "MEDIUM" as const, source: "insight", reason: "Asked about AIF", isManual: false },
];

describe("buildAcceptanceChips", () => {
  it("keeps order, adds heat and an accessible label with the reason", () => {
    const chips = buildAcceptanceChips(rows);
    expect(chips.map((c) => [c.assetClass, c.heat])).toEqual([["Mutual Funds", 3], ["PMS", 1], ["AIF", 2]]);
    expect(chips[1].label).toBe("PMS: Low acceptance. Declined twice (set by RM)");
    expect(chips[0].label).toBe("Mutual Funds: High acceptance. Holds funds");
  });
  it("is empty for no rows", () => expect(buildAcceptanceChips([])).toEqual([]));
});

describe("buildCallouts", () => {
  it("builds concentration, idle cash and external holdings callouts, skipping empty ones", () => {
    const c = buildCallouts({ concentration: { label: "Concentrated", hhi: 0.4 }, idleCash: 150000, externalPortfolio: 2500000 });
    expect(c.map((x) => x.key)).toEqual(["concentration", "idle", "external"]);
    expect(c[0]).toMatchObject({ tone: "warning", value: "Concentrated" });
    expect(c[1]).toMatchObject({ value: "₹1.50 L" });
    expect(c[2]).toMatchObject({ value: "₹25.00 L" });
    expect(c[2].hint).toContain("outside the firm");
    expect(JSON.stringify(c)).not.toContain("Allvest");
    expect(buildCallouts({ concentration: { label: "Diversified", hhi: 0.1 }, idleCash: null, externalPortfolio: 0 }).map((x) => x.key)).toEqual(["concentration"]);
    expect(buildCallouts({ concentration: null, idleCash: null, externalPortfolio: null })).toEqual([]);
  });
});
