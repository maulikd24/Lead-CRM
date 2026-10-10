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
