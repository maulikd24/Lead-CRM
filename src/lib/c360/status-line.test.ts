import { describe, expect, it } from "vitest";

import { dueFromTiming, statusLine } from "./status-line";

const base = { status: "ACTIVE", kycStatus: "APPROVED", stage: "Funded", archived: false };

describe("statusLine", () => {
  it("is one quiet line: status, KYC and stage", () => {
    expect(statusLine(base, null)).toEqual({ parts: ["Active", "KYC approved", "Funded"], warning: null });
  });
  it("says KYC has not started when there is no record, and spells enum values like words", () => {
    expect(statusLine({ ...base, kycStatus: null }, null).parts[1]).toBe("KYC not started");
    expect(statusLine({ ...base, status: "ON_HOLD", kycStatus: "IN_REVIEW" }, null).parts.slice(0, 2)).toEqual(["On hold", "KYC in review"]);
  });
  it("shows Archived in place of the status", () => {
    expect(statusLine({ ...base, archived: true }, null).parts[0]).toBe("Archived");
  });
  it("warns only when consent blocks something", () => {
    const ok = { marketing: "given" as const, salesPaused: false, doNotPitch: false };
    expect(statusLine(base, ok).warning).toBeNull();
    expect(statusLine(base, { ...ok, marketing: "not_recorded" }).warning).toBeNull();
    expect(statusLine(base, { ...ok, marketing: "withdrawn" }).warning).toBeNull();
    expect(statusLine(base, { ...ok, marketing: "do_not_contact" }).warning).toBe("Do not contact");
    expect(statusLine(base, { ...ok, salesPaused: true }).warning).toBe("Sales messages paused");
    expect(statusLine(base, { ...ok, doNotPitch: true }).warning).toBe("Do not pitch");
  });
  it("puts Do not contact first when several apply", () => {
    expect(statusLine(base, { marketing: "do_not_contact", salesPaused: true, doNotPitch: true }).warning).toBe("Do not contact");
  });
});

describe("dueFromTiming", () => {
  const now = new Date("2026-10-11T06:00:00.000Z");
  it("maps the engine's timing words to a due date", () => {
    expect(dueFromTiming("Today", now).toISOString()).toBe("2026-10-11T12:30:00.000Z");
    expect(dueFromTiming("This week", now).getTime()).toBeGreaterThan(now.getTime());
  });
  it("defaults to the next day when the timing is unknown", () => {
    expect(dueFromTiming("whenever", now).getTime() - now.getTime()).toBe(24 * 3600 * 1000);
  });
});
