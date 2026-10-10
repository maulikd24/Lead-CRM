import { describe, expect, it } from "vitest";

import { decideTouch, normalizeReferralCode } from "./touch";

const now = new Date("2026-10-10T06:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const active = { partnerProfileId: "p1", status: "ACTIVE" };

describe("normalizeReferralCode: anything odd is ignored, never guessed", () => {
  it("trims and upper-cases a plain code", () => {
    expect(normalizeReferralCode(" ptr-00001 ")).toBe("PTR-00001");
    expect(normalizeReferralCode("AB12CD")).toBe("AB12CD");
    expect(normalizeReferralCode("PTR-00001\n")).toBe("PTR-00001");
  });
  it.each(["", "   ", "ab", "x".repeat(41), "PTR 00001", "PTR_00001", "PTR-00001'; DROP TABLE x;--", "<script>", "../etc", "%PTR%", "PTR-00001,PTR-00002"])("rejects %j", (raw) => {
    expect(normalizeReferralCode(raw)).toBeNull();
  });
  it("rejects what is not text", () => {
    for (const raw of [undefined, null, 42, {}, [], ["PTR-00001"]]) expect(normalizeReferralCode(raw)).toBeNull();
  });
});

describe("decideTouch: first touch wins, a lapsed touch can be replaced", () => {
  it("records the first touch with an expiry window days later", () => {
    const d = decideTouch({ existing: null, partner: active, now, lapseDays: 90 });
    expect(d).toEqual({ decision: "recorded", expiresAt: new Date(now.getTime() + 90 * day) });
  });
  it("keeps the first touch while it has not lapsed, whoever comes second", () => {
    const existing = { partnerProfileId: "p1", expiresAt: new Date(now.getTime() + 10 * day) };
    expect(decideTouch({ existing, partner: { partnerProfileId: "p2", status: "ACTIVE" }, now, lapseDays: 90 })).toEqual({ decision: "kept_first_other", expiresAt: existing.expiresAt });
  });
  it("the same partner again is an idempotent no-op", () => {
    const existing = { partnerProfileId: "p1", expiresAt: new Date(now.getTime() + 10 * day) };
    expect(decideTouch({ existing, partner: active, now, lapseDays: 90 })).toEqual({ decision: "kept_first_same", expiresAt: existing.expiresAt });
  });
  it("a touch that has lapsed (expiry at or before now) can be replaced by any partner, including the same one", () => {
    const lapsed = { partnerProfileId: "p1", expiresAt: new Date(now.getTime() - 1) };
    expect(decideTouch({ existing: lapsed, partner: { partnerProfileId: "p2", status: "ACTIVE" }, now, lapseDays: 30 })).toEqual({ decision: "replaced_lapsed", expiresAt: new Date(now.getTime() + 30 * day) });
    expect(decideTouch({ existing: { ...lapsed, expiresAt: now }, partner: active, now, lapseDays: 30 }).decision).toBe("replaced_lapsed");
  });
  it("an unknown code is ignored", () => {
    expect(decideTouch({ existing: null, partner: null, now, lapseDays: 90 })).toEqual({ decision: "ignored_unknown" });
  });
  it("a partner who is not active earns no referral", () => {
    for (const status of ["ONBOARDING", "SUSPENDED", "TERMINATED"]) expect(decideTouch({ existing: null, partner: { partnerProfileId: "p1", status }, now, lapseDays: 90 })).toEqual({ decision: "ignored_inactive" });
  });
  it("a bad lapse window is refused rather than guessed", () => {
    expect(() => decideTouch({ existing: null, partner: active, now, lapseDays: 0 })).toThrow();
    expect(() => decideTouch({ existing: null, partner: active, now, lapseDays: 1.5 })).toThrow();
  });
});
