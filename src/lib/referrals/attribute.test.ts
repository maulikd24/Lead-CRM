import { beforeEach, describe, expect, it } from "vitest";

import { attributeSignup, claimKey } from "./attribute";
import { FakeStore } from "./fake-store";

const NOW = new Date("2027-01-10T10:00:00Z");
let store: FakeStore;

beforeEach(() => {
  store = new FakeStore();
  store.parties.set("cR", { clientId: "cR", phoneKey: "9800000001", emailKey: null, pan: null });
  store.parties.set("cN", { clientId: "cN", phoneKey: "9800000002", emailKey: null, pan: null });
  store.codes.set("ABCD2345", { id: "code1", referrerId: "ref1", status: "ACTIVE", createdAt: new Date("2027-01-01T00:00:00Z"), revokedAt: null, referrerStatus: "ACTIVE", referrer: store.parties.get("cR")! });
});

const run = (over: Partial<Parameters<typeof attributeSignup>[0]> = {}) =>
  attributeSignup({ store, userId: "u-1", referralCode: "abcd-2345", outcome: { status: "created", clientId: "cN" }, signedUpAt: NOW, ...over });

describe("attributeSignup", () => {
  it("credits a new person to the code's owner and records the signup event", async () => {
    expect(await run()).toEqual({ status: "attributed" });
    expect(store.referrals).toHaveLength(1);
    expect(store.referrals[0]).toMatchObject({ referrerId: "ref1", referredClientId: "cN" });
    expect(store.events.get(store.referrals[0].id)?.map((e) => e.type)).toEqual(["SIGNED_UP"]);
  });
  it("is idempotent: the same signup replayed changes nothing", async () => {
    await run();
    expect(await run()).toEqual({ status: "replay" });
    expect(store.referrals).toHaveLength(1);
  });
  it("treats a replay whose first attempt created the person like the original", async () => {
    expect(await run({ outcome: { status: "replay", previous: "CREATED", clientId: "cN" } })).toEqual({ status: "attributed" });
  });
  it("skips (writes nothing) when there is no code, or the signup was rejected or failed", async () => {
    expect((await run({ referralCode: undefined })).status).toBe("skipped");
    expect((await run({ outcome: { status: "rejected", reason: "x" } })).status).toBe("skipped");
    expect((await run({ outcome: { status: "error", error: "x" } })).status).toBe("skipped");
    expect(store.claims.size).toBe(0);
  });
  it("records an unknown or malformed code as a rejected claim, without failing", async () => {
    expect(await run({ referralCode: "ZZZZ2222" })).toEqual({ status: "rejected", reason: "UNKNOWN_CODE" });
    expect(await run({ userId: "u-2", referralCode: "not a code!" })).toEqual({ status: "rejected", reason: "UNKNOWN_CODE" });
    expect(store.referrals).toHaveLength(0);
    expect(store.claims.size).toBe(2);
  });
  it("blocks self-referral and a person who was already a customer", async () => {
    expect(await run({ outcome: { status: "duplicate", clientId: "cR" } })).toEqual({ status: "rejected", reason: "SELF_REFERRAL" });
    expect(await run({ userId: "u-2", outcome: { status: "duplicate", clientId: "cN" } })).toEqual({ status: "rejected", reason: "ALREADY_CUSTOMER" });
    expect(store.referrals).toHaveLength(0);
  });
  it("first touch wins: a second code for an already attributed person is rejected and the original stays", async () => {
    store.codes.set("WXYZ7788", { ...store.codes.get("ABCD2345")!, id: "code2", referrerId: "ref2" });
    await run();
    expect(await run({ userId: "u-9", referralCode: "WXYZ7788" })).toEqual({ status: "rejected", reason: "ALREADY_ATTRIBUTED" });
    expect(store.referrals).toHaveLength(1);
    expect(store.referrals[0].referrerId).toBe("ref1");
  });
  it("a lost race (the store reports a conflict) is a replay, not an error", async () => {
    store.saveClaim = async () => "conflict";
    expect(await run()).toEqual({ status: "replay" });
  });
});

describe("claimKey", () => {
  it("is stable per app user and never contains the raw app user id", () => {
    expect(claimKey("u-1")).toBe(claimKey("u-1"));
    expect(claimKey("u-1")).not.toBe(claimKey("u-2"));
    expect(claimKey("app-user-zq-7781")).not.toContain("zq-7781");
    expect(claimKey("u-1")).toMatch(/^allvest_app:[0-9a-f]{64}$/);
  });
});
