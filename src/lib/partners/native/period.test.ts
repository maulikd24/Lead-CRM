import { describe, expect, it } from "vitest";

import { fillMonths, fyKeyOf, fyKeyOfMonth, fyLabel, fyMonths, fyRange, istMonthStart, monthLabel, monthRange, parseStatementPeriod, recentMonths } from "./period";

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

describe("financial years in India (April to March, IST)", () => {
  it("names a year by its two calendar years", () => {
    expect(fyKeyOf(new Date("2026-04-01T00:00:00+05:30"))).toBe("2026-27");
    expect(fyKeyOf(new Date("2026-03-31T23:59:59+05:30"))).toBe("2025-26");
    expect(fyKeyOf(new Date("2026-12-31T20:00:00Z"))).toBe("2026-27"); // 01:30 IST on 1 Jan 2027, still FY 2026-27
  });
  it("gives the exact IST bounds as UTC instants", () => {
    const r = fyRange("2026-27")!;
    expect(r.start.toISOString()).toBe("2026-03-31T18:30:00.000Z");
    expect(r.end.toISOString()).toBe("2027-03-31T18:30:00.000Z");
  });
  it("labels a year for people and rejects keys that are not a year pair", () => {
    expect(fyLabel("2026-27")).toBe("FY 2026-27 (Apr 2026 to Mar 2027)");
    for (const bad of ["2026", "2026-28", "2026-2027", "26-27", "abcd-ef", "2026-27x"]) expect(fyRange(bad), bad).toBeNull();
    expect(fyRange("1999-00")).not.toBeNull(); // century rollover is still a valid pair
  });
  it("lists the months of a year in order, with their keys", () => {
    expect(fyMonths("2026-27")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
  });
  it("finds the year a month key belongs to", () => {
    expect(fyKeyOfMonth("2026-03")).toBe("2025-26");
    expect(fyKeyOfMonth("2026-04")).toBe("2026-27");
  });
});

describe("monthRange", () => {
  it("is the IST month as UTC instants, and rejects a bad key", () => {
    const r = monthRange("2026-09")!;
    expect(r.start.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    expect(r.end.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("2026-9")).toBeNull();
  });
});

describe("statement period keys", () => {
  it("parses run, open, month, financial year and cumulative year keys, and nothing else", () => {
    expect(parseStatementPeriod("open")).toEqual({ kind: "open" });
    expect(parseStatementPeriod("m-2026-09")).toEqual({ kind: "month", month: "2026-09" });
    expect(parseStatementPeriod("fy-2026-27")).toEqual({ kind: "fy", fy: "2026-27" });
    expect(parseStatementPeriod("fyc-2026-27")).toEqual({ kind: "fyc", fy: "2026-27" });
    expect(parseStatementPeriod("cmabc123xyz")).toEqual({ kind: "run", runId: "cmabc123xyz" });
    expect(parseStatementPeriod("m-2026-13")).toBeNull();
    expect(parseStatementPeriod("fy-2026-99")).toBeNull();
    expect(parseStatementPeriod("a b")).toBeNull();
    expect(parseStatementPeriod("")).toBeNull();
  });
});
