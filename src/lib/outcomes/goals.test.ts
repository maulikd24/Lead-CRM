import { describe, expect, it } from "vitest";

import { assetClassOf, buildGoalView, linkedClassKeys, type HoldingRef } from "./goals";

const holdings: HoldingRef[] = [
  { accountId: "a1", productId: "p1", name: "Fund One", category: "MUTUAL_FUND", value: 100_000 },
  { accountId: "a1", productId: "p2", name: "Stock Two", category: "EQUITY", value: 50_000 },
  { accountId: "a2", productId: "p1", name: "Fund One", category: "MUTUAL_FUND", value: 25_000 },
];
const asOf = new Date("2026-10-10T00:00:00Z");
const goal = { id: "g1", name: "Home", targetAmount: 1_000_000, targetDate: new Date("2031-10-10T00:00:00Z"), priority: "HIGH", status: "ACTIVE", annualRatePct: null, plannedMonthly: null, notes: null, linkedAccountIds: [] as string[], linkedHoldingKeys: [] as string[] };

describe("assetClassOf", () => {
  it("maps product categories to the four coarse classes and nothing finer", () => {
    expect(["EQUITY", "MUTUAL_FUND", "BOND", "FIXED_DEPOSIT", "PMS", "AIF", "NPS", "INSURANCE", "OTHER"].map(assetClassOf)).toEqual(["equity", "mutual_fund", "bonds", "bonds", "other", "other", "other", "other", "other"]);
  });
});

describe("linkedClassKeys", () => {
  it("a goal with no links holds nothing (progress is never guessed from everything the customer owns)", () => {
    expect(linkedClassKeys(goal, holdings)).toEqual([]);
  });
  it("reads stored class links", () => {
    expect(linkedClassKeys({ ...goal, linkedHoldingKeys: ["class:equity", "class:bogus"] }, holdings)).toEqual(["equity"]);
  });
  it("maps a legacy linked account to the classes held in it (read-time, nothing rewritten)", () => {
    expect(linkedClassKeys({ ...goal, linkedAccountIds: ["a1"] }, holdings)).toEqual(["equity", "mutual_fund"]);
  });
  it("maps a legacy linked holding to its class", () => {
    expect(linkedClassKeys({ ...goal, linkedHoldingKeys: ["a2:p1"] }, holdings)).toEqual(["mutual_fund"]);
  });
  it("ignores references to holdings the customer does not have (a stale link adds nothing)", () => {
    expect(linkedClassKeys({ ...goal, linkedAccountIds: ["zzz"], linkedHoldingKeys: ["zzz:p9"] }, holdings)).toEqual([]);
  });
});

describe("buildGoalView", () => {
  it("combines the goal, its linked holdings' value and the progress arithmetic", () => {
    const v = buildGoalView({ ...goal, linkedHoldingKeys: ["class:equity", "class:mutual_fund"] }, holdings, asOf);
    expect(v.progress.currentValue).toBe(175_000);
    expect(v.linkedCount).toBe(2);
    expect(v.progress.progressPct).toBe(17.5);
    expect(v.hasLinks).toBe(true);
  });
  it("flags a goal with no links so the screen can say progress shows as zero", () => {
    const v = buildGoalView(goal, holdings, asOf);
    expect(v.hasLinks).toBe(false);
    expect(v.progress.currentValue).toBe(0);
  });
  it("passes the goal's own assumed rate and stated monthly amount into the arithmetic", () => {
    const v = buildGoalView({ ...goal, annualRatePct: 11, plannedMonthly: 9_000 }, holdings, asOf);
    expect(v.progress.assumptions).toMatchObject({ annualRatePct: 11, rateIsDefault: false, plannedMonthly: 9_000 });
  });
});
