import { describe, expect, it } from "vitest";
import { mapAppSignup as map } from "./map-app-signup";
import { statusForMapperFailure, statusForOutcome } from "./outcome-status";

// Fixed clock so the fixture timestamps are never "in the future" whenever the suite runs.
const NOW = Date.parse("2026-10-09T10:01:00Z");
const mapAppSignup = (payload: unknown, now: number = NOW, opts?: { deviceKey?: string }) => map(payload, now, opts);

const valid = { userId: "u-123", name: "Riya Sharma", mobile: "+91 98765 43210", email: "riya@example.com", source: "referral", referralCode: "AB12CD", consentAt: "2026-10-09T10:00:00Z", signedUpAt: "2026-10-09T10:00:05Z" };

describe("mapAppSignup", () => {
  it("maps a valid signup to a lead", () => {
    const r = mapAppSignup(valid);
    expect(r).toMatchObject({ ok: true, lead: { source: "allvest_app", externalId: "u-123", leadSource: "App Signup (referral)", name: "Riya Sharma" } });
    if (r.ok) expect(r.lead.attribution).toMatchObject({ referral_code: "AB12CD", signup_source: "referral" });
  });
  it("uses the app user id as the idempotency key", () => {
    const a = mapAppSignup(valid);
    const b = mapAppSignup({ ...valid, name: "Riya S" });
    expect(a.ok && b.ok && a.lead.externalId === b.lead.externalId).toBe(true);
  });
  it("rejects a missing user id, mobile or consent", () => {
    for (const bad of [{ ...valid, userId: "" }, { ...valid, mobile: "" }, { ...valid, consentAt: undefined }]) {
      expect(mapAppSignup(bad)).toMatchObject({ ok: false });
    }
  });
  it("rejects non-objects", () => {
    expect(mapAppSignup(null)).toMatchObject({ ok: false });
    expect(mapAppSignup("x")).toMatchObject({ ok: false });
    expect(mapAppSignup([valid])).toMatchObject({ ok: false });
  });
  it("defaults an unknown source to organic", () => {
    const r = mapAppSignup({ ...valid, source: "mystery" });
    expect(r).toMatchObject({ ok: true, lead: { leadSource: "App Signup (organic)" } });
  });
  it("defaults a missing source to organic", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.source;
    expect(mapAppSignup(rest)).toMatchObject({ ok: true, lead: { leadSource: "App Signup (organic)" } });
  });

  it("accepts phone variants (+91, spaces, 10 digits, leading 0)", () => {
    for (const mobile of ["+91 98765 43210", "919876543210", "9876543210", "09876543210", "98765-43210"]) {
      expect(mapAppSignup({ ...valid, mobile })).toMatchObject({ ok: true });
    }
  });
  it("rejects a mobile that is not a plausible number", () => {
    for (const mobile of ["abcdefgh", "123", "1234567890123456789"]) {
      expect(mapAppSignup({ ...valid, mobile })).toMatchObject({ ok: false });
    }
  });

  it("trims the user id and accepts common id characters", () => {
    const r = mapAppSignup({ ...valid, userId: "  auth0|abc.123_X-9  " });
    // '|' is not allowed: ids are limited to [A-Za-z0-9._:@-]
    expect(r).toMatchObject({ ok: false });
    expect(mapAppSignup({ ...valid, userId: "  usr_AB.12:x@y-9 " })).toMatchObject({ ok: true, lead: { externalId: "usr_AB.12:x@y-9" } });
  });
  it("rejects user ids with odd characters or over 100 chars", () => {
    for (const userId of ["u 1", "u\n1", "u/../1", "ü-1", "<script>", "x".repeat(101)]) {
      expect(mapAppSignup({ ...valid, userId })).toMatchObject({ ok: false });
    }
    expect(mapAppSignup({ ...valid, userId: "x".repeat(100) })).toMatchObject({ ok: true });
  });

  it("trims the name and rejects a blank one", () => {
    expect(mapAppSignup({ ...valid, name: "  Riya Sharma \n" })).toMatchObject({ ok: true, lead: { name: "Riya Sharma" } });
    expect(mapAppSignup({ ...valid, name: "   " })).toMatchObject({ ok: false });
  });

  it("drops an invalid optional email but keeps the signup", () => {
    const r = mapAppSignup({ ...valid, email: "not-an-email" });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.lead.email).toBeUndefined();
  });
  it("keeps a valid email, trimmed", () => {
    const r = mapAppSignup({ ...valid, email: " riya@example.com " });
    if (r.ok) expect(r.lead.email).toBe("riya@example.com");
    else throw new Error("expected ok");
  });

  it("requires a valid consentAt timestamp (DPDP)", () => {
    for (const consentAt of [undefined, "", "yesterday", "2026-10-09", 12345, null]) {
      expect(mapAppSignup({ ...valid, consentAt })).toMatchObject({ ok: false });
    }
  });
  it("accepts a consentAt slightly ahead and clamps it to now", () => {
    for (const consentAt of ["2026-10-09T10:11:00Z", "2026-10-10T09:00:00Z"]) {
      const r = mapAppSignup({ ...valid, consentAt });
      expect(r).toMatchObject({ ok: true });
      if (r.ok) {
        expect(r.lead.consent?.at).toBe(new Date(NOW).toISOString());
        expect(r.contract.consentAt).toBe(new Date(NOW).toISOString());
      }
    }
  });
  it("rejects a consentAt more than 24 hours ahead", () => {
    expect(mapAppSignup({ ...valid, consentAt: "2026-10-10T11:00:00Z" })).toMatchObject({ ok: false });
    expect(mapAppSignup({ ...valid, consentAt: "2099-01-01T00:00:00Z" })).toMatchObject({ ok: false });
  });
  it("leaves a past consentAt unchanged", () => {
    const r = mapAppSignup(valid);
    if (r.ok) expect(r.lead.consent?.at).toBe("2026-10-09T10:00:00.000Z");
    else throw new Error("expected ok");
  });
  it("accepts consentAt with a timezone offset", () => {
    expect(mapAppSignup({ ...valid, consentAt: "2026-10-09T15:30:00+05:30" })).toMatchObject({ ok: true });
  });

  it("ignores unknown extra fields: they appear nowhere in the lead or contract", () => {
    const r = mapAppSignup({ ...valid, isAdmin: true, password: "hunter2", pan: "ABCDE1234F" });
    expect(r).toMatchObject({ ok: true });
    const text = JSON.stringify(r);
    for (const leak of ["password", "hunter2", "pan", "ABCDE1234F", "isAdmin"]) expect(text).not.toContain(leak);
    if (r.ok) expect(Object.keys(r.contract).sort()).toEqual(["city", "consentAt", "email", "mobile", "name", "referralCode", "signedUpAt", "source", "userId"].sort());
  });
  it("treats null and empty optionals like absent", () => {
    for (const field of ["city", "referralCode", "signedUpAt", "source", "email"]) {
      for (const v of [null, ""]) {
        const r = mapAppSignup({ ...valid, [field]: v });
        expect(r).toMatchObject({ ok: true });
        if (r.ok && field !== "source") expect(JSON.stringify(r.lead)).not.toContain(`"${field}":${v === null ? "null" : '""'}`);
        if (r.ok && field === "email") expect(r.lead.email).toBeUndefined();
        if (r.ok && field === "city") expect(r.lead.city).toBeUndefined();
        if (r.ok && field === "referralCode") expect(r.lead.attribution?.referral_code).toBeUndefined();
        if (r.ok && field === "signedUpAt") expect(r.lead.attribution?.signed_up_at).toBeUndefined();
      }
    }
  });
  it("carries the referral code as the partner code, to be looked up and never trusted", () => {
    const r = mapAppSignup(valid);
    if (r.ok) expect(r.lead.partnerCode).toBe("AB12CD");
    const none = mapAppSignup({ ...valid, referralCode: undefined });
    if (none.ok) expect(none.lead.partnerCode).toBeUndefined();
  });
  it("does not lose the signup over a malformed optional", () => {
    expect(mapAppSignup({ ...valid, signedUpAt: "garbage", city: 42, referralCode: "x".repeat(99) })).toMatchObject({ ok: true });
  });
  it("omits undefined attribution values", () => {
    const rest: Record<string, unknown> = { ...valid };
    delete rest.referralCode;
    delete rest.signedUpAt;
    const r = mapAppSignup(rest);
    if (r.ok) expect(Object.keys(r.lead.attribution ?? {}).filter((k) => r.lead.attribution?.[k] === undefined)).toEqual([]);
  });
});

describe("statusForOutcome", () => {
  it("maps ingest outcomes to HTTP responses", () => {
    expect(statusForOutcome({ status: "created", clientId: "c" })).toEqual({ http: 200, body: { ok: true, status: "created" } });
    expect(statusForOutcome({ status: "duplicate", clientId: "c" })).toEqual({ http: 200, body: { ok: true, status: "duplicate" } });
    expect(statusForOutcome({ status: "replay", previous: "CREATED" })).toEqual({ http: 200, body: { ok: true, status: "replay" } });
    expect(statusForOutcome({ status: "rejected", reason: "A valid phone number or email is required" })).toEqual({ http: 422, body: { error: "Signup rejected", reason: "A valid phone number or email is required" } });
    expect(statusForOutcome({ status: "error", error: "db down: secret detail" })).toEqual({ http: 500, body: { error: "Could not process signup" } });
  });
});

describe("statusForMapperFailure", () => {
  it("is a 422 Invalid payload with the reason", () => {
    expect(statusForMapperFailure("consentAt: bad")).toEqual({ http: 422, body: { error: "Invalid payload", reason: "consentAt: bad" } });
  });
});

describe("an optional device identifier (hashed on arrival, never stored raw)", () => {
  const KEY = "test-device-key";
  const DEVICE = "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7";
  const hashOf = (payload: Record<string, unknown>, key: string | undefined = KEY) => {
    const r = mapAppSignup(payload, undefined, { deviceKey: key });
    return r.ok ? r.contract.deviceHash : "not ok";
  };
  it("turns deviceId into a 64-character hash in the contract and keeps the raw value out of everything", () => {
    const r = mapAppSignup({ ...valid, deviceId: DEVICE }, undefined, { deviceKey: KEY });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.contract.deviceHash).toMatch(/^[0-9a-f]{64}$/);
    const everything = JSON.stringify(r);
    expect(everything).not.toContain(DEVICE);
    expect(everything).not.toContain("deviceId");
    expect(Object.keys(r.lead.attribution ?? {})).not.toContain("device_hash");
  });
  it("is stable for one device and key, and differs per device and per key", () => {
    expect(hashOf({ ...valid, deviceId: DEVICE })).toBe(hashOf({ ...valid, deviceId: DEVICE }));
    expect(hashOf({ ...valid, deviceId: DEVICE })).not.toBe(hashOf({ ...valid, deviceId: DEVICE + "x" }));
    expect(hashOf({ ...valid, deviceId: DEVICE })).not.toBe(hashOf({ ...valid, deviceId: DEVICE }, "another-key"));
  });
  it("is not hashed without a key (an unkeyed hash of an identifier would be guessable), so it is simply dropped", () => {
    const r = mapAppSignup({ ...valid, deviceId: DEVICE });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.contract.deviceHash).toBeUndefined();
    expect(hashOf({ ...valid, deviceId: DEVICE }, "")).toBeUndefined();
  });
  it.each([["too short", "abc"], ["has spaces", "device id with spaces 123"], ["too long", "x".repeat(200)], ["not text", 12345678], ["empty", ""], ["null", null], ["control characters", "abcdefgh\u0000ijkl"]])("drops a malformed id (%s) and keeps the signup", (_n, v) => {
    expect(hashOf({ ...valid, deviceId: v })).toBeUndefined();
    expect(mapAppSignup({ ...valid, deviceId: v }, undefined, { deviceKey: KEY })).toMatchObject({ ok: true });
  });
  it("a payload with no deviceId has no deviceHash key at all (the contract is unchanged for existing callers)", () => {
    const r = mapAppSignup(valid, undefined, { deviceKey: KEY });
    if (r.ok) expect("deviceHash" in r.contract).toBe(false);
  });
});
