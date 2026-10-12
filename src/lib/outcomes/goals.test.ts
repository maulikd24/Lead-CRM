import { describe, expect, it } from "vitest";

import { buildGoalView, holdingsLinkedTo, type HoldingRef } from "./goals";

const holdings: HoldingRef[] = [
  { accountId: "a1", productId: "p1", name: "Fund One", category: "MUTUAL_FUND", value: 100_000 },
  { accountId: "a1", productId: "p2", name: "Stock Two", category: "EQUITY", value: 50_000 },
  { accountId: "a2", productId: "p1", name: "Fund One", category: "MUTUAL_FUND", value: 25_000 },
];
const asOf = new Date("2026-10-10T00:00:00Z");
const goal = { id: "g1", name: "Home", targetAmount: 1_000_000, targetDate: new Date("2031-10-10T00:00:00Z"), priority: "HIGH", status: "ACTIVE", annualRatePct: null, plannedMonthly: null, notes: null, linkedAccountIds: [] as string[], linkedHoldingKeys: [] as string[] };

describe("holdingsLinkedTo", () => {
  it("a goal with no links holds nothing (progress is never guessed from everything the customer owns)", () => {
    expect(holdingsLinkedTo(goal, holdings)).toEqual([]);
  });
  it("a linked account brings all its holdings", () => {
    expect(holdingsLinkedTo({ ...goal, linkedAccountIds: ["a1"] }, holdings).map((h) => h.productId)).toEqual(["p1", "p2"]);
  });
  it("a linked holding brings only that one", () => {
    expect(holdingsLinkedTo({ ...goal, linkedHoldingKeys: ["a2:p1"] }, holdings)).toHaveLength(1);
  });
  it("an account and one of its holdings linked together are counted once", () => {
    const linked = holdingsLinkedTo({ ...goal, linkedAccountIds: ["a1"], linkedHoldingKeys: ["a1:p1", "a2:p1"] }, holdings);
    expect(linked.reduce((s, h) => s + h.value, 0)).toBe(175_000);
  });
  it("ignores references to holdings the customer does not have (a stale link adds nothing)", () => {
    expect(holdingsLinkedTo({ ...goal, linkedAccountIds: ["zzz"], linkedHoldingKeys: ["zzz:p9"] }, holdings)).toEqual([]);
  });
});

describe("buildGoalView", () => {
  it("combines the goal, its linked holdings' value and the progress arithmetic", () => {
    const v = buildGoalView({ ...goal, linkedAccountIds: ["a1"] }, holdings, asOf);
    expect(v.progress.currentValue).toBe(150_000);
    expect(v.linkedCount).toBe(2);
    expect(v.progress.progressPct).toBe(15);
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
