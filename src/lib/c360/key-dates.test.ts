import { describe, expect, it } from "vitest";

import { buildKeyDates } from "./key-dates";

const d = (s: string) => new Date(s);
const NOW = d("2026-10-09T12:00:00Z");

describe("buildKeyDates", () => {
  it("marks completed steps and the next one as current", () => {
    const r = buildKeyDates({ signedUpAt: d("2026-09-01T00:00:00Z"), kycCompletedAt: d("2026-09-04T00:00:00Z"), firstFundedAt: null, firstTransactionAt: null }, NOW);
    expect(r.steps.map((s) => s.state)).toEqual(["done", "done", "current", "pending"]);
    expect(r.steps[1].elapsed).toBe("+3d");
    expect(r.steps[2].date).toBeNull();
  });
  it("fills the track up to the last completed step", () => {
    const none = buildKeyDates({ signedUpAt: d("2026-09-01T00:00:00Z"), kycCompletedAt: null, firstFundedAt: null, firstTransactionAt: null }, NOW);
    expect(none.fillPct).toBe(0);
    const some = buildKeyDates({ signedUpAt: d("2026-09-01T00:00:00Z"), kycCompletedAt: d("2026-09-04T00:00:00Z"), firstFundedAt: d("2026-09-10T00:00:00Z"), firstTransactionAt: null }, NOW);
    expect(some.fillPct).toBeCloseTo(66.67, 1);
    const all = buildKeyDates({ signedUpAt: d("2026-09-01T00:00:00Z"), kycCompletedAt: d("2026-09-04T00:00:00Z"), firstFundedAt: d("2026-09-10T00:00:00Z"), firstTransactionAt: d("2026-09-12T00:00:00Z") }, NOW);
    expect(all.fillPct).toBe(100);
    expect(all.steps.every((s) => s.state === "done")).toBe(true);
  });
  it("treats a later step as done even if an earlier date is missing (data gaps)", () => {
    const r = buildKeyDates({ signedUpAt: d("2026-09-01T00:00:00Z"), kycCompletedAt: null, firstFundedAt: d("2026-09-10T00:00:00Z"), firstTransactionAt: null }, NOW);
    expect(r.steps.map((s) => s.state)).toEqual(["done", "current", "done", "pending"]);
    expect(r.fillPct).toBeCloseTo(66.67, 1);
  });
  it("shows how long the current step has waited", () => {
    const r = buildKeyDates({ signedUpAt: d("2026-09-29T12:00:00Z"), kycCompletedAt: null, firstFundedAt: null, firstTransactionAt: null }, NOW);
    expect(r.steps[1].waiting).toBe("10d waiting");
  });
});
