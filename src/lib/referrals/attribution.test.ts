import { describe, expect, it } from "vitest";

import { decideAttribution, type AttributionInput } from "./attribution";

const T0 = new Date("2027-01-10T10:00:00Z");
const base = (over: Partial<AttributionInput> = {}): AttributionInput => ({
  code: { id: "code1", referrerId: "ref1", status: "ACTIVE", createdAt: new Date("2027-01-01T00:00:00Z"), revokedAt: null },
  referrerStatus: "ACTIVE",
  referrer: { clientId: "cR", phoneKey: "9800000001", emailKey: "r@example.test", pan: "ABCDE1234F" },
  referred: { clientId: "cN", phoneKey: "9800000002", emailKey: "n@example.test", pan: null },
  outcome: "created",
  signedUpAt: T0,
  alreadyAttributed: false,
  ...over,
});

describe("decideAttribution", () => {
  it("attributes a new person who used a live code", () => {
    expect(decideAttribution(base())).toEqual({ kind: "attribute", codeId: "code1", referrerId: "ref1" });
  });
  it("rejects an unknown code", () => {
    expect(decideAttribution(base({ code: null }))).toEqual({ kind: "reject", reason: "UNKNOWN_CODE" });
  });
  it("never applies a code to a signup that happened before the code existed (no rewriting history)", () => {
    const r = decideAttribution(base({ signedUpAt: new Date("2026-12-31T00:00:00Z") }));
    expect(r).toEqual({ kind: "reject", reason: "CODE_NOT_YET_ISSUED" });
  });
  it("rejects a signup after revocation but honours one made before it", () => {
    const code = { id: "code1", referrerId: "ref1", status: "REVOKED" as const, createdAt: new Date("2027-01-01T00:00:00Z"), revokedAt: new Date("2027-01-05T00:00:00Z") };
    expect(decideAttribution(base({ code }))).toEqual({ kind: "reject", reason: "CODE_REVOKED" });
    expect(decideAttribution(base({ code, signedUpAt: new Date("2027-01-03T00:00:00Z") })).kind).toBe("attribute");
  });
  it("rejects when the referrer is suspended", () => {
    expect(decideAttribution(base({ referrerStatus: "SUSPENDED" }))).toEqual({ kind: "reject", reason: "REFERRER_INACTIVE" });
  });
  it("blocks self-referral by client id, phone key, email key or PAN", () => {
    const r = base().referrer!;
    expect(decideAttribution(base({ referred: { ...r } }))).toEqual({ kind: "reject", reason: "SELF_REFERRAL" });
    expect(decideAttribution(base({ referred: { clientId: "x", phoneKey: r.phoneKey, emailKey: null, pan: null } })).kind).toBe("reject");
    expect(decideAttribution(base({ referred: { clientId: "x", phoneKey: null, emailKey: r.emailKey, pan: null } })).kind).toBe("reject");
    expect(decideAttribution(base({ referred: { clientId: "x", phoneKey: null, emailKey: null, pan: r.pan } })).kind).toBe("reject");
  });
  it("a missing key never collides with another missing key", () => {
    const referrer = { clientId: "cR", phoneKey: null, emailKey: null, pan: null };
    const referred = { clientId: "cN", phoneKey: null, emailKey: null, pan: null };
    expect(decideAttribution(base({ referrer, referred })).kind).toBe("attribute");
  });
  it("blocks a person who was already a customer (duplicate person)", () => {
    expect(decideAttribution(base({ outcome: "duplicate" }))).toEqual({ kind: "reject", reason: "ALREADY_CUSTOMER" });
  });
  it("first touch wins", () => {
    expect(decideAttribution(base({ alreadyAttributed: true }))).toEqual({ kind: "reject", reason: "ALREADY_ATTRIBUTED" });
  });
});
