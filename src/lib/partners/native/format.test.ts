import { describe, expect, it } from "vitest";

import { istDay, longDay, periodLabel, periodShort, words } from "./format";

describe("istDay", () => {
  it("is the calendar date in India", () => {
    expect(istDay("2026-09-30T18:45:00Z")).toBe("2026-10-01");
    expect(istDay("2026-09-30T18:15:00Z")).toBe("2026-09-30");
  });
  it("is empty for rubbish", () => expect(istDay("nope")).toBe(""));
});

describe("longDay", () => {
  it("writes a day for people", () => expect(longDay("2026-09-05T05:00:00Z")).toBe("5 Sep 2026"));
  it("is a dash for nothing", () => {
    expect(longDay(null)).toBe("—");
    expect(longDay("nope")).toBe("—");
  });
});

describe("periodLabel and periodShort for a payout period whose end is exclusive", () => {
  const start = "2026-08-31T18:30:00.000Z"; // 1 Sep 00:00 IST
  const end = "2026-09-30T18:30:00.000Z"; // 1 Oct 00:00 IST
  it("names the last day inside the period, not the day after", () => expect(periodLabel(start, end)).toBe("1 Sep 2026 to 30 Sep 2026"));
  it("shortens a period inside one month", () => expect(periodShort(start, end)).toBe("1 to 30 Sep 2026"));
  it("keeps both ends when the period crosses a month", () => {
    expect(periodShort("2026-09-14T18:30:00.000Z", "2026-10-14T18:30:00.000Z")).toBe("15 Sep 2026 to 14 Oct 2026");
  });
  it("is the single day when start and end are one day apart", () => {
    expect(periodShort("2026-08-31T18:30:00.000Z", "2026-09-01T18:30:00.000Z")).toBe("1 Sep 2026");
  });
});

describe("words", () => {
  it("turns an enum into text", () => {
    expect(words("TRAIL_COMMISSION")).toBe("Trail commission");
    expect(words("")).toBe("");
  });
});
