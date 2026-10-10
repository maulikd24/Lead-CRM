import { describe, expect, it, vi } from "vitest";

import { FakeStore } from "./fake-store";
import { attributeAfterIngest } from "./webhook";

const NOW = new Date("2027-01-10T10:00:00Z");
function seeded() {
  const store = new FakeStore();
  store.parties.set("cR", { clientId: "cR", phoneKey: "9800000001", emailKey: null, pan: null });
  store.parties.set("cN", { clientId: "cN", phoneKey: "9800000002", emailKey: null, pan: null });
  store.codes.set("ABCD2345", { id: "code1", referrerId: "ref1", status: "ACTIVE", createdAt: new Date("2027-01-01T00:00:00Z"), revokedAt: null, referrerStatus: "ACTIVE", referrer: store.parties.get("cR")! });
  return store;
}
const contract = { userId: "u-1", referralCode: "ABCD-2345" };

describe("attributeAfterIngest", () => {
  it("does nothing, and never touches the store, while the flag is off", async () => {
    const store = seeded();
    const spy = vi.spyOn(store, "findClaim");
    const r = await attributeAfterIngest({ env: {}, store, contract, outcome: { status: "created", clientId: "cN" }, now: NOW });
    expect(r).toEqual({ status: "skipped" });
    expect(spy).not.toHaveBeenCalled();
    expect(store.claims.size).toBe(0);
  });
  it("attributes when the flag is on", async () => {
    const store = seeded();
    const r = await attributeAfterIngest({ env: { REFERRAL_PROGRAM_ENABLED: "1" }, store, contract, outcome: { status: "created", clientId: "cN" }, now: NOW });
    expect(r).toEqual({ status: "attributed" });
  });
  it("a signup with no code is untouched even with the flag on", async () => {
    const store = seeded();
    const r = await attributeAfterIngest({ env: { REFERRAL_PROGRAM_ENABLED: "1" }, store, contract: { userId: "u-2" }, outcome: { status: "created", clientId: "cN" }, now: NOW });
    expect(r).toEqual({ status: "skipped" });
  });
  it("never throws: a store failure is swallowed so the signup still succeeds", async () => {
    const store = seeded();
    store.findClaim = async () => {
      throw new Error("db down");
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await attributeAfterIngest({ env: { REFERRAL_PROGRAM_ENABLED: "1" }, store, contract, outcome: { status: "created", clientId: "cN" }, now: NOW });
    expect(r).toEqual({ status: "failed" });
    expect(JSON.stringify(err.mock.calls)).not.toContain("ABCD");
    err.mockRestore();
  });
});

const ON = { REFERRAL_PROGRAM_ENABLED: "1" };
const created = { status: "created" as const, clientId: "cN" };

describe("coexistence with the partner programme", () => {
  it("a code that belongs to a partner alone is left to the partner: no claim, no rejected row", async () => {
    const store = seeded();
    const probe = vi.fn(async (c: string) => c === "PRTN2345");
    expect(await attributeAfterIngest({ env: ON, store, contract: { userId: "u-1", referralCode: " PRTN2345 " }, outcome: created, now: NOW, partnerProbe: probe })).toEqual({ status: "partner" });
    expect(probe).toHaveBeenCalledWith("PRTN2345");
    expect(store.claims.size).toBe(0);
  });
  it("a code that is both a partner code and a consumer code credits the referral too, flagged for review", async () => {
    const store = seeded();
    const r = await attributeAfterIngest({ env: ON, store, contract, outcome: created, now: NOW, partnerProbe: async () => true });
    expect(r).toEqual({ status: "attributed" });
    expect(store.referrals).toHaveLength(1);
    expect(store.referralFlags.get(store.referrals[0].id)).toEqual(["PARTNER_CODE_ALSO_PRESENT"]);
  });
  it("a separate partner code next to a consumer referral code: the referral is recorded and flagged", async () => {
    const store = seeded();
    const probe = async (c: string) => c === "PRTN2345";
    const r = await attributeAfterIngest({ env: ON, store, contract: { ...contract, partnerCode: "PRTN2345" } as never, outcome: created, now: NOW, partnerProbe: probe });
    expect(r).toEqual({ status: "attributed" });
    expect(store.referralFlags.get(store.referrals[0].id)).toEqual(["PARTNER_CODE_ALSO_PRESENT"]);
  });
  it("without a partner programme wired in (the default) every code is handled as a consumer code, unflagged", async () => {
    const store = seeded();
    expect(await attributeAfterIngest({ env: ON, store, contract, outcome: created, now: NOW })).toEqual({ status: "attributed" });
    expect(store.referralFlags.get(store.referrals[0].id) ?? []).toEqual([]);
  });
  it("a partner lookup that fails is logged (no code in the log) and the code is handled as a consumer code", async () => {
    const store = seeded();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await attributeAfterIngest({ env: ON, store, contract, outcome: created, now: NOW, partnerProbe: async () => { throw new Error("partner db down ABCD2345"); } });
    expect(r).toEqual({ status: "attributed" });
    expect(JSON.stringify(err.mock.calls)).not.toContain("ABCD2345");
    err.mockRestore();
  });
  it("an unknown code that is nobody's is still recorded as rejected", async () => {
    const store = seeded();
    expect(await attributeAfterIngest({ env: ON, store, contract: { userId: "u-1", referralCode: "ZZZZ2222" }, outcome: created, now: NOW, partnerProbe: async () => false })).toEqual({ status: "rejected" });
    expect(store.claims.size).toBe(1);
  });
});

describe("device hashes", () => {
  const dev = "d".repeat(64);
  it("records the hashed device for the customer on any signup, with or without a code, once", async () => {
    const store = seeded();
    await attributeAfterIngest({ env: ON, store, contract: { userId: "u-2", deviceHash: dev }, outcome: created, now: NOW });
    await attributeAfterIngest({ env: ON, store, contract: { userId: "u-2", deviceHash: dev }, outcome: { status: "replay", previous: "CREATED", clientId: "cN" }, now: NOW });
    expect([...(store.devices.get("cN") ?? [])]).toEqual([dev]);
  });
  it("stores nothing while the flag is off", async () => {
    const store = seeded();
    await attributeAfterIngest({ env: {}, store, contract: { userId: "u-2", deviceHash: dev }, outcome: created, now: NOW });
    expect(store.devices.size).toBe(0);
  });
  it("stores nothing for a rejected or failed signup (no customer)", async () => {
    const store = seeded();
    await attributeAfterIngest({ env: ON, store, contract: { userId: "u-2", deviceHash: dev }, outcome: { status: "rejected", reason: "x" }, now: NOW });
    expect(store.devices.size).toBe(0);
  });
  it("travels with the credit, on the referral", async () => {
    const store = seeded();
    await attributeAfterIngest({ env: ON, store, contract: { ...contract, deviceHash: dev }, outcome: created, now: NOW });
    expect(store.referralDevice.get(store.referrals[0].id)).toBe(dev);
  });
  it("a failure to record the device never costs the referral credit or the signup", async () => {
    const store = seeded();
    vi.spyOn(store, "recordDevice").mockRejectedValue(new Error("blip"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await attributeAfterIngest({ env: ON, store, contract: { ...contract, deviceHash: dev }, outcome: created, now: NOW })).toEqual({ status: "attributed" });
    err.mockRestore();
  });
  it("the device hash never appears in a log line", async () => {
    const store = seeded();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(store, "recordDevice").mockRejectedValue(new Error(`blip ${dev}`));
    await attributeAfterIngest({ env: ON, store, contract: { ...contract, deviceHash: dev }, outcome: created, now: NOW });
    expect(JSON.stringify(err.mock.calls)).not.toContain(dev);
    err.mockRestore();
  });
});
