import { describe, expect, it } from "vitest";
import { addDays, buildWindows, dayDiff, dateToYmd, todayInTimeZone, ymdToDate } from "./dates";

describe("todayInTimeZone", () => {
  it("returns the calendar day in the account timezone, not UTC", () => {
    const instant = new Date("2026-10-08T20:00:00Z"); // 01:30 on the 9th in Kolkata, still the 8th in New York
    expect(todayInTimeZone(instant, "Asia/Kolkata")).toBe("2026-10-09");
    expect(todayInTimeZone(instant, "America/New_York")).toBe("2026-10-08");
  });
  it("falls back to UTC for an unknown timezone", () => {
    expect(todayInTimeZone(new Date("2026-10-08T20:00:00Z"), "Not/AZone")).toBe("2026-10-08");
  });
});

describe("date arithmetic", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("measures day differences and round-trips through Date", () => {
    expect(dayDiff("2026-10-01", "2026-10-08")).toBe(7);
    expect(dateToYmd(ymdToDate("2026-10-08"))).toBe("2026-10-08");
    expect(ymdToDate("2026-10-08").toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });
});

describe("buildWindows", () => {
  it("splits an inclusive range into consecutive windows of at most N days, oldest first", () => {
    expect(buildWindows("2026-10-01", "2026-10-10", 7)).toEqual([
      { since: "2026-10-01", until: "2026-10-07" },
      { since: "2026-10-08", until: "2026-10-10" },
    ]);
  });
  it("returns one window for a short range and none for an inverted one", () => {
    expect(buildWindows("2026-10-03", "2026-10-03", 7)).toEqual([{ since: "2026-10-03", until: "2026-10-03" }]);
    expect(buildWindows("2026-10-05", "2026-10-03", 7)).toEqual([]);
  });
});
