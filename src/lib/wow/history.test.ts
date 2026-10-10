import { describe, expect, it } from "vitest";

import { bucketCounts, bucketSums, cumulative, previousWindow } from "./history";

const d = (iso: string) => new Date(iso);

describe("cumulative", () => {
  it("is a running total on top of what was there before the window", () => {
    expect(cumulative(10, [1, 0, 2, 3])).toEqual([11, 11, 13, 16]);
  });
  it("is empty for an empty window", () => {
    expect(cumulative(5, [])).toEqual([]);
  });
});

describe("bucketCounts and bucketSums", () => {
  const start = d("2026-10-01T00:00:00Z");
  const day = 86_400_000;
  it("counts rows into equal buckets, ignoring rows outside the window", () => {
    const rows = [d("2026-10-01T05:00:00Z"), d("2026-10-01T23:00:00Z"), d("2026-10-03T01:00:00Z"), d("2026-09-30T23:59:59Z"), d("2026-10-04T00:00:00Z")];
    expect(bucketCounts(rows, start, day, 3)).toEqual([2, 0, 1]);
  });
  it("sums values into the same buckets", () => {
    const rows = [{ at: d("2026-10-01T05:00:00Z"), value: 100 }, { at: d("2026-10-02T05:00:00Z"), value: 50 }, { at: d("2026-10-02T06:00:00Z"), value: 25 }];
    expect(bucketSums(rows, start, day, 3)).toEqual([100, 75, 0]);
  });
});

describe("previousWindow", () => {
  it("is the window of the same length that ends where this one starts", () => {
    const start = d("2026-10-08T00:00:00Z");
    const prev = previousWindow(start, 7 * 86_400_000);
    expect(prev.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
