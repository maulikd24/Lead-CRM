/**
 * The app-signup webhook with the referral hook live, driven the way the app does it: a raw JSON body, a real HMAC
 * signature (no mocked verification), the real route, the real mapper and the real attribution services. Only the
 * database edge is faked: the lead intake (a phone number it has seen is a duplicate) and the referral store.
 */
import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeStore } from "@/lib/referrals/fake-store";
import type { CodeLookup } from "@/lib/referrals/store";
import { claimKey } from "@/lib/referrals/attribute";

const SECRET = "test-signup-secret";
const store = new FakeStore();
const phones = new Map<string, string>();
const intake = vi.fn();

vi.mock("@/lib/security/rate-limit", () => ({ clientIp: () => "1.1.1.1", rateLimit: async () => ({ allowed: true }), tooManyRequests: () => new Response("", { status: 429 }) }));
vi.mock("@/lib/referrals/prisma-store", () => ({ prismaReferralStore: store }));
vi.mock("@/lib/leads/ingest", () => ({ ingestLead: (...a: unknown[]) => intake(...a) }));

import { POST } from "./route";

const sign = (raw: string, secret = SECRET) => createHmac("sha256", secret).update(raw, "utf8").digest("hex");
function call(payload: Record<string, unknown>, opts: { signature?: string | null; prefix?: boolean; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify({ name: "Test Person", mobile: "9800000002", consentAt: new Date().toISOString(), userId: "u-1", ...payload });
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature = opts.signature === undefined ? sign(raw) : opts.signature;
  if (signature !== null) headers["x-signature"] = (opts.prefix ? "sha256=" : "") + signature;
  return POST(new Request("http://localhost/api/webhooks/app-signup", { method: "POST", headers, body: raw }));
}

const at = new Date("2020-01-01T00:00:00Z");
const referrer = { clientId: "cR", phoneKey: "9800000001", emailKey: null, pan: null };
function seed() {
  store.parties.clear(); store.codes.clear(); store.claims.clear(); store.referrals.length = 0; store.events.clear(); phones.clear();
  store.parties.set("cR", referrer);
  store.parties.set("referrer-of:ref1", referrer);
  phones.set("9800000001", "cR");
  const base = (): CodeLookup => ({ id: `id-${Math.random()}`, referrerId: "ref1", status: "ACTIVE", createdAt: at, revokedAt: null, referrerStatus: "ACTIVE", referrer });
  const code = (value: string, over: Partial<CodeLookup> = {}) => store.codes.set(value, { ...base(), ...over });
  code("ABCD2345");
  code("REVK2345", { status: "REVOKED", revokedAt: new Date("2020-06-01T00:00:00Z") });
  code("SPND2345", { referrerStatus: "SUSPENDED" });
}

/** Mimics the lead intake: a phone seen before is a duplicate of that customer; a repeat userId is a replay. */
function fakeIntake() {
  const seenUsers = new Map<string, string>();
  intake.mockImplementation(async (lead: { externalId: string; phone: string }) => {
    const previous = seenUsers.get(lead.externalId);
    if (previous) return { status: "replay", previous: "CREATED", clientId: previous };
    const known = phones.get(lead.phone);
    if (known) return { status: "duplicate", clientId: known };
    const id = `c-${lead.externalId}`;
    phones.set(lead.phone, id);
    seenUsers.set(lead.externalId, id);
    store.parties.set(id, { clientId: id, phoneKey: lead.phone, emailKey: null, pan: null });
    return { status: "created", clientId: id };
  });
}

beforeEach(() => {
  process.env.APP_SIGNUP_SECRET = SECRET;
  process.env.REFERRAL_PROGRAM_ENABLED = "1";
  intake.mockReset();
  seed();
  fakeIntake();
});

const claimOf = (userId: string) => store.claims.get(claimKey(userId));

describe("a signed app signup carrying a referral code", () => {
  it("credits the code, writes the signup event, and answers exactly as it does without a code", async () => {
    const res = await call({ referralCode: "ABCD2345" });
    expect(res.status).toBe(200);
    const withCode = await res.json();
    expect(claimOf("u-1")).toMatchObject({ outcome: "ATTRIBUTED", referrerId: "ref1", referredClientId: "c-u-1" });
    expect(store.referrals).toHaveLength(1);
    expect(store.events.get(store.referrals[0].id)?.map((e) => e.type)).toEqual(["SIGNED_UP"]);
    const plain = await (await call({ userId: "u-2", mobile: "9800000003" })).json();
    expect(withCode).toEqual(plain);
  });

  it("normalises how people type a code (lower case, dashes, spaces)", async () => {
    await call({ referralCode: " abcd-2345 " });
    expect(claimOf("u-1")).toMatchObject({ outcome: "ATTRIBUTED" });
  });

  it("accepts the sha256= signature prefix", async () => {
    expect((await call({ referralCode: "ABCD2345" }, { prefix: true })).status).toBe(200);
    expect(claimOf("u-1")).toMatchObject({ outcome: "ATTRIBUTED" });
  });

  it("a replay of the same signed body changes nothing: one claim, one referral, same answer", async () => {
    const raw = JSON.stringify({ userId: "u-1", name: "Test Person", mobile: "9800000002", consentAt: new Date().toISOString(), referralCode: "ABCD2345" });
    const first = await call({}, { raw });
    const again = await call({}, { raw });
    const third = await call({}, { raw });
    expect([first.status, again.status, third.status]).toEqual([200, 200, 200]);
    expect(store.claims.size).toBe(1);
    expect(store.referrals).toHaveLength(1);
    expect(store.events.get(store.referrals[0].id)).toHaveLength(1);
  });

  it("a replay that tries a different code later does not move the credit (first touch wins)", async () => {
    store.codes.set("OTHR2345", { ...store.codes.get("ABCD2345")!, id: "other", referrerId: "ref2" });
    await call({ referralCode: "ABCD2345" });
    await call({ referralCode: "OTHR2345" });
    expect(store.referrals).toHaveLength(1);
    expect(store.referrals[0].referrerId).toBe("ref1");
  });

  it("a signup with no code writes nothing in the referral tables", async () => {
    await call({});
    expect(store.claims.size).toBe(0);
  });
});

describe("codes that must not credit anyone", () => {
  it.each([
    ["an unknown code", "NOPE2345", "UNKNOWN_CODE"],
    ["a malformed code", "!!!", "UNKNOWN_CODE"],
    ["a code made of look-alike characters", "OOOO0000", "UNKNOWN_CODE"],
    ["a revoked code", "REVK2345", "CODE_REVOKED"],
    ["a code whose referrer is suspended", "SPND2345", "REFERRER_INACTIVE"],
  ])("%s is recorded as rejected and the signup still succeeds", async (_n, code, reason) => {
    const res = await call({ referralCode: code });
    expect(res.status).toBe(200);
    expect(claimOf("u-1")).toMatchObject({ outcome: "REJECTED", reason, referredClientId: null });
    expect(store.referrals).toHaveLength(0);
  });

  it("a code that is revoked only AFTER the signup does not undo the credit", async () => {
    store.codes.set("RVKA2345", { ...store.codes.get("ABCD2345")!, status: "REVOKED", revokedAt: new Date(Date.now() + 86_400_000) });
    await call({ referralCode: "RVKA2345" });
    expect(claimOf("u-1")).toMatchObject({ outcome: "ATTRIBUTED" });
  });

  it("a code created after the signup moment is not honoured (history is not rewritten)", async () => {
    store.codes.set("FTRE2345", { ...store.codes.get("ABCD2345")!, createdAt: new Date(Date.now() + 86_400_000) });
    await call({ referralCode: "FTRE2345" });
    expect(claimOf("u-1")).toMatchObject({ outcome: "REJECTED", reason: "CODE_NOT_YET_ISSUED" });
  });

  it("the answer does not reveal whether a code is valid", async () => {
    const good = await (await call({ referralCode: "ABCD2345" })).json();
    const bad = await (await call({ userId: "u-9", mobile: "9800000009", referralCode: "NOPE2345" })).json();
    expect(good).toEqual(bad);
  });
});

describe("people who cannot be referred", () => {
  it("self-referral: the referrer signing up again with their own phone and their own code", async () => {
    await call({ referralCode: "ABCD2345", mobile: "9800000001", userId: "u-self" });
    expect(claimOf("u-self")).toMatchObject({ outcome: "REJECTED", reason: "SELF_REFERRAL" });
  });

  it("self-referral through a different app account that shares the referrer's phone", async () => {
    await call({ referralCode: "ABCD2345", mobile: "9800000001", userId: "u-other-account" });
    expect(claimOf("u-other-account")).toMatchObject({ outcome: "REJECTED", reason: "SELF_REFERRAL" });
  });

  it("a person who is already a customer (duplicate person) is not a referral", async () => {
    phones.set("9800000077", "cExisting");
    store.parties.set("cExisting", { clientId: "cExisting", phoneKey: "9800000077", emailKey: null, pan: null });
    const res = await call({ referralCode: "ABCD2345", mobile: "9800000077", userId: "u-dup" });
    expect(res.status).toBe(200);
    expect(claimOf("u-dup")).toMatchObject({ outcome: "REJECTED", reason: "ALREADY_CUSTOMER" });
    expect(store.referrals).toHaveLength(0);
  });

  it("the same person arriving under a second app account is not credited twice", async () => {
    await call({ referralCode: "ABCD2345", userId: "u-1" });
    await call({ referralCode: "ABCD2345", userId: "u-1b" });
    expect(store.referrals).toHaveLength(1);
    expect(claimOf("u-1b")).toMatchObject({ outcome: "REJECTED", reason: "ALREADY_CUSTOMER" });
  });

  it("a rejected signup (bad mobile) writes no referral row at all", async () => {
    const res = await call({ referralCode: "ABCD2345", mobile: "12" });
    expect(res.status).toBe(422);
    expect(store.claims.size).toBe(0);
    expect(intake).not.toHaveBeenCalled();
  });
});

describe("authentication comes first", () => {
  it.each([
    ["no signature", { signature: null }],
    ["a wrong signature", { signature: "deadbeef".repeat(8) }],
    ["a signature made with another secret", { signature: sign("x", "other") }],
    ["an empty signature", { signature: "" }],
  ])("%s: 401, nothing ingested, nothing credited", async (_n, opts) => {
    const res = await call({ referralCode: "ABCD2345" }, opts);
    expect(res.status).toBe(401);
    expect(intake).not.toHaveBeenCalled();
    expect(store.claims.size).toBe(0);
  });

  it("a body changed after signing (the code swapped) is refused", async () => {
    const original = JSON.stringify({ userId: "u-1", name: "Test Person", mobile: "9800000002", consentAt: new Date().toISOString(), referralCode: "NOPE2345" });
    const signature = sign(original);
    const tampered = original.replace("NOPE2345", "ABCD2345");
    const res = await call({}, { raw: tampered, signature });
    expect(res.status).toBe(401);
    expect(store.claims.size).toBe(0);
  });

  it("404 while the feed is not enabled", async () => {
    delete process.env.APP_SIGNUP_SECRET;
    expect((await call({ referralCode: "ABCD2345" })).status).toBe(404);
    expect(store.claims.size).toBe(0);
  });
});

describe("the flag and failures never change the answer", () => {
  it("flag off: the signup succeeds and nothing is credited", async () => {
    delete process.env.REFERRAL_PROGRAM_ENABLED;
    expect((await call({ referralCode: "ABCD2345" })).status).toBe(200);
    expect(store.claims.size).toBe(0);
  });

  it("the store throwing is logged without the code and the signup is still answered 200", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = vi.spyOn(store, "findClaim").mockRejectedValue(new Error("db down ABCD2345"));
    const res = await call({ referralCode: "ABCD2345" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(log.mock.calls)).not.toContain("ABCD2345");
    boom.mockRestore();
    log.mockRestore();
  });

  it("after a failure the same signup replayed later is credited once (the retry heals it)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = vi.spyOn(store, "saveClaim").mockRejectedValueOnce(new Error("blip"));
    const raw = JSON.stringify({ userId: "u-1", name: "Test Person", mobile: "9800000002", consentAt: new Date().toISOString(), referralCode: "ABCD2345" });
    expect((await call({}, { raw })).status).toBe(200);
    expect(store.claims.size).toBe(0);
    expect((await call({}, { raw })).status).toBe(200);
    expect(store.referrals).toHaveLength(1);
    boom.mockRestore();
  });

  it("an ingest error (500) is passed through and nothing is credited", async () => {
    intake.mockResolvedValue({ status: "error", error: "db" });
    const res = await call({ referralCode: "ABCD2345" });
    expect(res.status).toBe(500);
    expect(store.claims.size).toBe(0);
  });
});

describe("the device identifier", () => {
  const DEVICE = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it("reaches the intake only as a keyed hash; the raw id appears in nothing that is stored", async () => {
    expect((await call({ referralCode: "ABCD2345", deviceId: DEVICE })).status).toBe(200);
    const [lead, contract] = intake.mock.calls[0];
    expect(JSON.stringify([lead, contract])).not.toContain(DEVICE);
    expect(contract.deviceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(store.claims)).not.toContain(DEVICE);
  });
  it("the same device yields the same hash across signups (that is what makes a collision detectable)", async () => {
    await call({ userId: "u-1", mobile: "9800000002", deviceId: DEVICE });
    await call({ userId: "u-2", mobile: "9800000003", deviceId: DEVICE });
    expect(intake.mock.calls[0][1].deviceHash).toBe(intake.mock.calls[1][1].deviceHash);
  });
  it("DEVICE_HASH_KEY, when set, is what keys the hash", async () => {
    await call({ userId: "u-1", deviceId: DEVICE });
    process.env.DEVICE_HASH_KEY = "separate-key";
    await call({ userId: "u-3", mobile: "9800000004", deviceId: DEVICE });
    delete process.env.DEVICE_HASH_KEY;
    expect(intake.mock.calls[0][1].deviceHash).not.toBe(intake.mock.calls[1][1].deviceHash);
  });
});
