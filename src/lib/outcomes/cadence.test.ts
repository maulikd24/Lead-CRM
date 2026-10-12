import { describe, expect, it } from "vitest";

import { OUTCOME_CONFIG } from "./config";
import { reviewStatus, tierFor } from "./cadence";

const now = new Date("2026-10-10T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

describe("tierFor", () => {
  it("assigns the tier from current holdings value", () => {
    expect(tierFor(20_000_000)?.key).toBe("A");
    expect(tierFor(10_000_000)?.key).toBe("A");
    expect(tierFor(5_000_000)?.key).toBe("B");
    expect(tierFor(100)?.key).toBe("C");
  });
  it("has no tier, and so no review cadence, without holdings", () => {
    expect(tierFor(0)).toBeNull();
  });
});

describe("reviewStatus", () => {
  it("is overdue when the cadence has run out since the last review", () => {
    const s = reviewStatus({ aum: 20_000_000, lastReviewAt: daysAgo(100), createdAt: daysAgo(900), now });
    expect(s).toMatchObject({ tier: "A", cadenceDays: 90, overdue: true, daysOverdue: 10 });
  });
  it("is not overdue inside the cadence", () => {
    expect(reviewStatus({ aum: 20_000_000, lastReviewAt: daysAgo(60), createdAt: daysAgo(900), now }).overdue).toBe(false);
  });
  it("counts from the customer's start when there has never been a review", () => {
    const s = reviewStatus({ aum: 5_000_000, lastReviewAt: null, createdAt: daysAgo(200), now });
    expect(s).toMatchObject({ tier: "B", overdue: true, daysOverdue: 20, neverReviewed: true });
  });
  it("has nothing to review without a tier", () => {
    expect(reviewStatus({ aum: 0, lastReviewAt: null, createdAt: daysAgo(500), now })).toMatchObject({ tier: null, overdue: false, cadenceDays: null });
  });
  it("reads cadence from the config it is given", () => {
    const cfg = { ...OUTCOME_CONFIG, tiers: [{ key: "A", label: "Tier A", minAum: 1, reviewEveryDays: 30 }] } as unknown as typeof OUTCOME_CONFIG;
    expect(reviewStatus({ aum: 5, lastReviewAt: daysAgo(40), createdAt: daysAgo(400), now }, cfg).overdue).toBe(true);
  });
});
