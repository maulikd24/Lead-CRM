import { describe, expect, it } from "vitest";
import { INCLUDED_REVENUE_TYPES, netRevenue, type RevenueEventLite } from "./revenue";

const ev = (over: Partial<RevenueEventLite>): RevenueEventLite => ({ id: "e", revenueType: "BROKERAGE", amount: 100, reversesEventId: null, reversedType: null, ...over });

describe("netRevenue", () => {
  it("counts only revenue earned from the customer's own activity", () => {
    expect(INCLUDED_REVENUE_TYPES).toEqual(["BROKERAGE", "ADVISORY_FEE"]);
    const total = netRevenue([ev({ amount: 100 }), ev({ id: "b", revenueType: "ADVISORY_FEE", amount: 50 }), ev({ id: "c", revenueType: "TRAIL_COMMISSION", amount: 999 }), ev({ id: "d", revenueType: "AMC_PAYOUT", amount: 999 }), ev({ id: "f", revenueType: "UPFRONT_COMMISSION", amount: 999 }), ev({ id: "g", revenueType: "OTHER", amount: 999 })]);
    expect(total).toBe(150);
  });
  it("nets a reversal against its original, however the sign was stored", () => {
    expect(netRevenue([ev({ id: "o", amount: 100 }), ev({ id: "r", amount: -100, reversesEventId: "o", reversedType: "BROKERAGE" })])).toBe(0);
    expect(netRevenue([ev({ id: "o", amount: 100 }), ev({ id: "r", amount: 100, reversesEventId: "o", reversedType: "BROKERAGE" })])).toBe(0);
  });
  it("applies a partial reversal", () => {
    expect(netRevenue([ev({ id: "o", amount: 100 }), ev({ id: "r", amount: -30, reversesEventId: "o", reversedType: "BROKERAGE" })])).toBe(70);
  });
  it("ignores a reversal of an excluded type", () => {
    expect(netRevenue([ev({ id: "o", revenueType: "TRAIL_COMMISSION", amount: 100 }), ev({ id: "r", revenueType: "TRAIL_COMMISSION", amount: -100, reversesEventId: "o", reversedType: "TRAIL_COMMISSION" }), ev({ id: "b", amount: 10 })])).toBe(10);
  });
  it("never goes below zero overall and is 0 for no events", () => {
    expect(netRevenue([])).toBe(0);
    expect(netRevenue([ev({ id: "r", amount: -50, reversesEventId: "gone", reversedType: "BROKERAGE" })])).toBe(0);
  });
});
