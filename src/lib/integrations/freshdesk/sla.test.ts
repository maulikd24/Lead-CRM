import { describe, expect, it } from "vitest";
import { addBusinessMinutes, BUSINESS_HOURS, dueFor, slaProgress } from "./sla";

const at = (s: string) => new Date(s);
const iso = (d: Date) => d.toISOString();

describe("business hours constant", () => {
  it("is Mon-Fri 09:30-18:30 IST", () => {
    expect(BUSINESS_HOURS).toEqual({ offsetMinutes: 330, startMinute: 570, endMinute: 1110, workdays: [1, 2, 3, 4, 5] });
  });
});

describe("addBusinessMinutes", () => {
  it("adds within a working day", () => {
    expect(iso(addBusinessMinutes(at("2026-10-07T10:00:00+05:30"), 120))).toBe(iso(at("2026-10-07T12:00:00+05:30")));
  });
  it("rolls over the end of the day", () => {
    // Wed 17:30 + 2h = 1h today + 1h next morning (09:30 -> 10:30)
    expect(iso(addBusinessMinutes(at("2026-10-07T17:30:00+05:30"), 120))).toBe(iso(at("2026-10-08T10:30:00+05:30")));
  });
  it("skips the weekend: Friday 17:30 + one working day (9h) is Monday 17:30", () => {
    expect(iso(addBusinessMinutes(at("2026-10-09T17:30:00+05:30"), 540))).toBe(iso(at("2026-10-12T17:30:00+05:30")));
  });
  it("starts counting at the next opening when raised out of hours", () => {
    // Sat 11:00 + 1h -> Monday 10:30
    expect(iso(addBusinessMinutes(at("2026-10-10T11:00:00+05:30"), 60))).toBe(iso(at("2026-10-12T10:30:00+05:30")));
    // Wed 03:00 IST + 30m -> Wed 10:00
    expect(iso(addBusinessMinutes(at("2026-10-07T03:00:00+05:30"), 30))).toBe(iso(at("2026-10-07T10:00:00+05:30")));
  });
  it("zero minutes returns the same instant", () => {
    expect(iso(addBusinessMinutes(at("2026-10-07T10:00:00+05:30"), 0))).toBe(iso(at("2026-10-07T10:00:00+05:30")));
  });
});

describe("dueFor", () => {
  const from = at("2026-10-09T17:30:00+05:30"); // Friday evening
  it("urgent task is 2 wall-clock hours, even at the weekend", () => {
    expect(iso(dueFor("urgent", "task", from))).toBe(iso(at("2026-10-09T19:30:00+05:30")));
  });
  it("high task is one working day", () => {
    expect(iso(dueFor("high", "task", from))).toBe(iso(at("2026-10-12T17:30:00+05:30")));
  });
  it("medium and low are two and three working days", () => {
    expect(iso(dueFor("medium", "task", from))).toBe(iso(at("2026-10-13T17:30:00+05:30")));
    expect(iso(dueFor("low", "task", from))).toBe(iso(at("2026-10-14T17:30:00+05:30")));
  });
  it("urgent first response is 1h and resolution 4h on the wall clock", () => {
    expect(iso(dueFor("urgent", "firstResponse", from))).toBe(iso(at("2026-10-09T18:30:00+05:30")));
    expect(iso(dueFor("urgent", "resolution", from))).toBe(iso(at("2026-10-09T21:30:00+05:30")));
  });
});

describe("slaProgress", () => {
  const start = at("2026-10-07T10:00:00Z");
  const due = at("2026-10-07T14:00:00Z");
  it("is ok early", () => expect(slaProgress(start, due, at("2026-10-07T11:00:00Z"))).toMatchObject({ state: "ok", pct: 25 }));
  it("is at risk past 75%", () => expect(slaProgress(start, due, at("2026-10-07T13:30:00Z"))).toMatchObject({ state: "at_risk" }));
  it("is breached after due, with pct clamped to 100", () => expect(slaProgress(start, due, at("2026-10-07T15:00:00Z"))).toMatchObject({ state: "breached", pct: 100 }));
  it("is met when finished before due, breached when finished late", () => {
    expect(slaProgress(start, due, at("2026-10-08T00:00:00Z"), at("2026-10-07T12:00:00Z")).state).toBe("met");
    expect(slaProgress(start, due, at("2026-10-08T00:00:00Z"), at("2026-10-07T15:00:00Z")).state).toBe("breached");
  });
  it("handles a degenerate window", () => expect(slaProgress(start, start, start).pct).toBe(100));
});
