import { describe, expect, it, vi } from "vitest";

import { FakeStore } from "./fake-store";
import { runReferralJob } from "./job";

const rows = [{ userId: "u-1", referralCode: "ABCD2345", clientId: "cN", receivedAt: new Date("2027-01-10T10:00:00Z") }];
function seeded() {
  const store = new FakeStore();
  const referrer = { clientId: "cR", phoneKey: "9800000001", emailKey: null, pan: null };
  store.parties.set("cR", referrer);
  store.parties.set("referrer-of:ref1", referrer);
  store.parties.set("cN", { clientId: "cN", phoneKey: "9800000002", emailKey: null, pan: null });
  store.codes.set("ABCD2345", { id: "code1", referrerId: "ref1", status: "ACTIVE", createdAt: new Date("2027-01-01T00:00:00Z"), revokedAt: null, referrerStatus: "ACTIVE", referrer });
  return store;
}

describe("runReferralJob", () => {
  it("is a no-op while the flag is off", async () => {
    const store = seeded();
    const load = vi.fn(async () => rows);
    expect(await runReferralJob({ env: {}, store, loadSignups: load, now: new Date() })).toEqual({ skipped: "flag off" });
    expect(load).not.toHaveBeenCalled();
  });
  it("re-attributes signups the webhook hook missed, then refreshes progress", async () => {
    const store = seeded();
    const out = await runReferralJob({ env: { REFERRAL_PROGRAM_ENABLED: "1" }, store, loadSignups: async () => rows, now: new Date("2027-01-11T00:00:00Z") });
    expect(out).toMatchObject({ reattributed: 1, referralsChecked: 1 });
    expect(store.referrals).toHaveLength(1);
    const again = await runReferralJob({ env: { REFERRAL_PROGRAM_ENABLED: "1" }, store, loadSignups: async () => rows, now: new Date("2027-01-11T00:00:00Z") });
    expect(again).toMatchObject({ reattributed: 0 });
    expect(store.referrals).toHaveLength(1);
  });

  it("one signup that keeps failing does not starve the others: it is counted, the rest are credited, and the next run heals", async () => {
    const store = seeded();
    store.parties.set("cM", { clientId: "cM", phoneKey: "9800000003", emailKey: null, pan: null });
    const many = [
      { userId: "u-bad", referralCode: "ABCD2345", clientId: "cN", receivedAt: new Date("2027-01-10T10:00:00Z") },
      { userId: "u-ok", referralCode: "ABCD2345", clientId: "cM", receivedAt: new Date("2027-01-10T11:00:00Z") },
    ];
    const real = store.saveClaim.bind(store);
    let failing = true;
    vi.spyOn(store, "saveClaim").mockImplementation(async (c) => {
      if (failing && c.referredClientId === "cN") throw new Error("db blip");
      return real(c);
    });
    const env = { REFERRAL_PROGRAM_ENABLED: "1" };
    const first = await runReferralJob({ env, store, loadSignups: async () => many, now: new Date("2027-01-11T00:00:00Z") });
    expect(first).toMatchObject({ reattributed: 1, failed: 1 });
    expect(store.referrals.map((r) => r.referredClientId)).toEqual(["cM"]);
    failing = false;
    const second = await runReferralJob({ env, store, loadSignups: async () => many, now: new Date("2027-01-11T00:05:00Z") });
    expect(second).toMatchObject({ reattributed: 1, failed: 0 });
    expect(store.referrals.map((r) => r.referredClientId).sort()).toEqual(["cM", "cN"]);
    const third = await runReferralJob({ env, store, loadSignups: async () => many, now: new Date("2027-01-11T00:10:00Z") });
    expect(third).toMatchObject({ reattributed: 0, failed: 0 });
    expect(store.referrals).toHaveLength(2);
  });

  it("an unreadable signup ledger is reported but progress is still refreshed", async () => {
    const store = seeded();
    const out = await runReferralJob({ env: { REFERRAL_PROGRAM_ENABLED: "1" }, store, loadSignups: async () => { throw new Error("ledger down"); }, now: new Date("2027-01-11T00:00:00Z") });
    expect(out).toMatchObject({ reattributed: 0, ledgerError: "Error", referralsChecked: 0 });
  });

  it("a failing log line never carries the referral code or the app user id", async () => {
    const store = seeded();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store, "findClaim").mockRejectedValue(new Error("boom ABCD2345 u-1"));
    await runReferralJob({ env: { REFERRAL_PROGRAM_ENABLED: "1" }, store, loadSignups: async () => rows, now: new Date("2027-01-11T00:00:00Z") });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("ABCD2345");
    expect(logged).not.toContain("u-1");
    log.mockRestore();
  });

  it("carries the hashed device of a missed signup onto the credit and remembers it for the customer", async () => {
    const store = seeded();
    const dev = "e".repeat(64);
    await runReferralJob({ env: { REFERRAL_PROGRAM_ENABLED: "1" }, store, loadSignups: async () => [{ ...rows[0], deviceHash: dev }], now: new Date("2027-01-11T00:00:00Z") });
    expect(store.referralDevice.get(store.referrals[0].id)).toBe(dev);
    expect([...(store.devices.get("cN") ?? [])]).toEqual([dev]);
  });
  it("a signup whose code is a partner's is left to the partner (no claim) when the partner programme says so", async () => {
    const store = seeded();
    await runReferralJob({ env: { REFERRAL_PROGRAM_ENABLED: "1" }, store, loadSignups: async () => [{ ...rows[0], referralCode: "PRTN2345" }], partnerProbe: async (c) => c === "PRTN2345", now: new Date("2027-01-11T00:00:00Z") });
    expect(store.claims.size).toBe(0);
  });
});
