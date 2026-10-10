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
});
