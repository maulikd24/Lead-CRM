import { describe, expect, it } from "vitest";

import { formatInZone, monthGrid, zonedLocalToUtc } from "./zoned-time";

describe("zonedLocalToUtc", () => {
  it("reads a wall-clock time in the given zone", () => {
    expect(zonedLocalToUtc("2026-10-20T09:30", "Asia/Kolkata")?.toISOString()).toBe("2026-10-20T04:00:00.000Z");
    expect(zonedLocalToUtc("2026-10-20T09:30", "UTC")?.toISOString()).toBe("2026-10-20T09:30:00.000Z");
  });
  it("handles daylight saving on both sides", () => {
    expect(zonedLocalToUtc("2026-07-01T12:00", "America/New_York")?.toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(zonedLocalToUtc("2026-12-01T12:00", "America/New_York")?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
  });
  it("rejects garbage and impossible dates", () => {
    expect(zonedLocalToUtc("tomorrow", "UTC")).toBeNull();
    expect(zonedLocalToUtc("2026-02-30T10:00", "UTC")).toBeNull();
    expect(zonedLocalToUtc("2026-10-20T25:00", "UTC")).toBeNull();
    expect(zonedLocalToUtc("2026-10-20T09:30", "Not/AZone")).toBeNull();
  });
});

describe("formatInZone", () => {
  it("shows a date and time in the zone", () => {
    expect(formatInZone(new Date("2026-10-20T04:00:00Z"), "Asia/Kolkata")).toMatch(/20 Oct/);
    expect(formatInZone(new Date("2026-10-20T04:00:00Z"), "Asia/Kolkata")).toMatch(/9:30/);
  });
});

describe("monthGrid", () => {
  it("returns whole Monday-first weeks covering the month", () => {
    const grid = monthGrid("2026-10");
    expect(grid.weeks.every((w) => w.length === 7)).toBe(true);
    expect(grid.weeks[0][0]).toMatchObject({ date: "2026-09-28", inMonth: false });
    expect(grid.weeks[0][3]).toMatchObject({ date: "2026-10-01", inMonth: true });
    expect(grid.weeks.at(-1)!.at(-1)).toMatchObject({ date: "2026-11-01", inMonth: false });
    expect(grid.label).toBe("October 2026");
  });
  it("gives the neighbouring months", () => {
    expect(monthGrid("2026-01")).toMatchObject({ prev: "2025-12", next: "2026-02" });
    expect(monthGrid("2026-12")).toMatchObject({ prev: "2026-11", next: "2027-01" });
  });
  it("a bad month falls back to the current one", () => {
    expect(monthGrid("junk", "2026-10-10").month).toBe("2026-10");
  });
});
