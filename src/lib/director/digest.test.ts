import { describe, expect, it } from "vitest";

import { buildDigestEmail, digestDue, previousWeeks } from "./digest";
import { buildDirectorReport, type PeriodData } from "./report";

describe("previousWeeks (India time, Monday to Sunday)", () => {
  it("on a Monday the digest covers the week that just ended and compares with the one before", () => {
    const w = previousWeeks(new Date("2026-10-12T03:00:00Z")); // Monday 12 Oct, 08:30 in India
    expect(w.current).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(w.previous).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(w.weekStart).toBe("2026-10-05");
  });
  it("later in the week it is still the last full week", () => {
    expect(previousWeeks(new Date("2026-10-15T10:00:00Z")).weekStart).toBe("2026-10-05");
  });
  it("on a Sunday it is the week before that (this week is not over)", () => {
    expect(previousWeeks(new Date("2026-10-11T10:00:00Z")).weekStart).toBe("2026-09-28");
  });
});

describe("digestDue", () => {
  it("not before Monday 07:00 local", () => {
    expect(digestDue(new Date("2026-10-12T00:30:00Z"), new Set())).toEqual({ due: false });
  });
  it("due on Monday after 07:00 when none exists for that week", () => {
    expect(digestDue(new Date("2026-10-12T03:00:00Z"), new Set())).toEqual({ due: true, weekStart: "2026-10-05" });
  });
  it("not due when the week already has a digest", () => {
    expect(digestDue(new Date("2026-10-12T03:00:00Z"), new Set(["2026-10-05"]))).toEqual({ due: false });
  });
  it("catches up later in the same week", () => {
    expect(digestDue(new Date("2026-10-14T10:00:00Z"), new Set())).toEqual({ due: true, weekStart: "2026-10-05" });
  });
  it("on a Sunday does not prepare the digest for the week just starting", () => {
    expect(digestDue(new Date("2026-10-11T10:00:00Z"), new Set(["2026-09-28"]))).toEqual({ due: false });
  });
});

describe("buildDigestEmail", () => {
  const p = (from: string, to: string, funded: number): PeriodData => ({ from, to, currency: "INR", channels: [{ channel: "meta", available: true, spend: 1000, leads: 10, kyc: 5, funded, revenue: 500, costPerFunded: null, roas: null }], campaigns: [], asOf: { meta: "2026-10-11T20:00:00Z", google: null, referral: null, partner: null }, notes: [], paid: { costPerFunded: null, roas: null } });
  const report = buildDirectorReport({ current: p("2026-10-05", "2026-10-11", 8), previous: p("2026-09-28", "2026-10-04", 6), generatedAt: "2026-10-12T03:00:00Z" });
  it("is plainly a draft, names the week, quotes the numbers and sends nothing", () => {
    const e = buildDigestEmail(report, ["dir@example.com"]);
    expect(e.subject).toMatch(/5 Oct.*11 Oct/);
    expect(e.bodyText).toMatch(/DRAFT/);
    expect(e.bodyText).toMatch(/Funded customers: 8/);
    expect(e.bodyText).toMatch(/Data as of/i);
    expect(e.recipients).toEqual(["dir@example.com"]);
  });
  it("has no customer data in it", () => {
    expect(buildDigestEmail(report, []).bodyText).not.toMatch(/@|\b\d{10}\b/);
  });
});
