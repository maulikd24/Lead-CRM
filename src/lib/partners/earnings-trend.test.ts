import { describe, expect, it } from "vitest";

import { earningsTrend } from "./earnings-trend";

const monthly = [
  { period: "2026-07", earnings: 100 },
  { period: "2026-08", earnings: 150 },
  { period: "2026-09", earnings: 200 },
  { period: "2026-10", earnings: 30 },
];

describe("earningsTrend", () => {
  it("is the running total by month", () => {
    expect(earningsTrend(monthly, new Date("2026-10-11T00:00:00Z")).cumulative).toEqual([100, 250, 450, 480]);
  });
  it("compares the last full month with the one before it, ignoring the month in progress", () => {
    expect(earningsTrend(monthly, new Date("2026-10-11T00:00:00Z")).delta).toEqual({ pct: 33, direction: "up" });
  });
  it("has no comparison when a month is missing", () => {
    expect(earningsTrend(monthly.slice(2), new Date("2026-10-11T00:00:00Z")).delta).toBeNull();
  });
  it("handles the turn of the year", () => {
    const m = [{ period: "2025-11", earnings: 50 }, { period: "2025-12", earnings: 100 }, { period: "2026-01", earnings: 5 }];
    expect(earningsTrend(m, new Date("2026-01-09T00:00:00Z")).delta).toEqual({ pct: 100, direction: "up" });
  });
});
