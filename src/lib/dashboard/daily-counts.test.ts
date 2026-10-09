import { describe, expect, it } from "vitest";
import { dailyCounts } from "./daily-counts";

describe("dailyCounts", () => {
  it("buckets by day, oldest first", () => {
    const now = new Date(2026, 9, 9, 15, 0);
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 0);
    expect(dailyCounts([at(9, 1), at(9, 14), at(8, 23), at(6, 5), at(1, 1)], 4, now)).toEqual([1, 0, 1, 2]);
  });
});
