import { describe, expect, it } from "vitest";

import { fillMonths, istMonthStart, monthLabel, recentMonths } from "./period";

describe("istMonthStart (calendar months in India, returned as UTC instants)", () => {
  it("is midnight IST on the first, which is 18:30 UTC the evening before", () => {
    expect(istMonthStart(new Date("2026-09-15T10:00:00Z")).toISOString()).toBe("2026-08-31T18:30:00.000Z");
  });
  it("counts an instant just after midnight IST as the new month", () => {
    // 2026-09-30T18:45Z is 00:15 IST on 1 October.
    expect(istMonthStart(new Date("2026-09-30T18:45:00Z")).toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });
  it("counts an instant just before midnight IST as the old month", () => {
    expect(istMonthStart(new Date("2026-09-30T18:15:00Z")).toISOString()).toBe("2026-08-31T18:30:00.000Z");
  });
  it("moves by whole months, across a year end", () => {
    expect(istMonthStart(new Date("2026-01-10T00:00:00Z"), -1).toISOString()).toBe("2025-11-30T18:30:00.000Z");
    expect(istMonthStart(new Date("2026-12-10T00:00:00Z"), 1).toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });
});

describe("recentMonths", () => {
  it("lists the last n month keys, oldest first, ending with the current month", () => {
    expect(recentMonths(new Date("2026-02-10T00:00:00Z"), 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("monthLabel", () => {
  it("is short and readable", () => {
    expect(monthLabel("2026-09")).toBe("Sep 2026");
    expect(monthLabel("nonsense")).toBe("nonsense");
  });
});

describe("fillMonths", () => {
  it("fills months with no revenue with zero so the chart has no gaps", () => {
    const out = fillMonths(["2026-07", "2026-08", "2026-09"], [{ period: "2026-08", amount: "12.50" }]);
    expect(out).toEqual([
      { period: "2026-07", earnings: 0 },
      { period: "2026-08", earnings: 12.5 },
      { period: "2026-09", earnings: 0 },
    ]);
  });
  it("ignores data outside the requested months", () => {
    expect(fillMonths(["2026-09"], [{ period: "2020-01", amount: "5" }])).toEqual([{ period: "2026-09", earnings: 0 }]);
  });
});
