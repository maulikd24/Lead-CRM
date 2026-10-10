import { beforeEach, describe, expect, it } from "vitest";

import { enrollReferrer, issueCode, revokeCode, saveRule, saveSetting, setReferrerStatus, setRuleActive } from "./admin";
import { FakeAdmin } from "./fake-admin";

const NOW = new Date("2027-01-10T10:00:00Z");
const admin = { id: "u-admin", role: "ADMIN" as const };
let db: FakeAdmin;
const form = { name: "KYC bonus", event: "KYC_COMPLETE", kind: "FIXED", amountRupees: "100", maxRewardRupees: "", capPerMonthRupees: "", validFrom: "", validTo: "" };

beforeEach(() => {
  db = new FakeAdmin();
  db.clients.set("CL-00001", { id: "c1", name: "Asha Test", status: "ACTIVE", mergedIntoId: null, isDeleted: false });
});

describe("enrollReferrer", () => {
  it("makes an existing customer a referrer with a first code", async () => {
    const r = await enrollReferrer({ db, actor: admin, clientCode: " cl-00001 " });
    expect(r.ok).toBe(true);
    expect(db.referrers).toHaveLength(1);
    expect(db.codes).toHaveLength(1);
    expect(db.codes[0].code).toHaveLength(8);
  });
  it("refuses an unknown, merged or archived customer, and a second enrolment", async () => {
    expect((await enrollReferrer({ db, actor: admin, clientCode: "CL-99999" })).ok).toBe(false);
    db.clients.set("CL-00002", { id: "c2", name: "X", status: "ACTIVE", mergedIntoId: "c1", isDeleted: false });
    db.clients.set("CL-00003", { id: "c3", name: "Y", status: "ACTIVE", mergedIntoId: null, isDeleted: true });
    expect((await enrollReferrer({ db, actor: admin, clientCode: "CL-00002" })).ok).toBe(false);
    expect((await enrollReferrer({ db, actor: admin, clientCode: "CL-00003" })).ok).toBe(false);
    await enrollReferrer({ db, actor: admin, clientCode: "CL-00001" });
    expect((await enrollReferrer({ db, actor: admin, clientCode: "CL-00001" })).ok).toBe(false);
  });
  it("retries when a generated code is already taken", async () => {
    let n = 0;
    db.takenCodes.add("22222222");
    const rng = () => (n++ < 8 ? 0 : 1); // first draw 22222222 (taken), then 33333333
    expect((await enrollReferrer({ db, actor: admin, clientCode: "CL-00001", rng })).ok).toBe(true);
    expect(db.codes[0].code).toBe("33333333");
  });
  it("is Admin only", async () => {
    expect((await enrollReferrer({ db, actor: { id: "f", role: "FINANCE" }, clientCode: "CL-00001" })).ok).toBe(false);
  });
});

describe("codes and referrer status", () => {
  it("issues another code and revokes one with a reason", async () => {
    const r = (await enrollReferrer({ db, actor: admin, clientCode: "CL-00001" })) as { ok: true; referrerId: string };
    expect((await issueCode({ db, actor: admin, referrerId: r.referrerId })).ok).toBe(true);
    expect(db.codes).toHaveLength(2);
    expect((await revokeCode({ db, actor: admin, codeId: db.codes[0].id, reason: "" })).ok).toBe(false);
    expect((await revokeCode({ db, actor: admin, codeId: db.codes[0].id, reason: "Shared publicly by mistake" })).ok).toBe(true);
    expect(db.codes[0]).toMatchObject({ status: "REVOKED", revokeReason: "Shared publicly by mistake" });
    expect((await revokeCode({ db, actor: admin, codeId: db.codes[0].id, reason: "again please" })).ok).toBe(false);
  });
  it("suspends and reactivates a referrer", async () => {
    const r = (await enrollReferrer({ db, actor: admin, clientCode: "CL-00001" })) as { ok: true; referrerId: string };
    expect((await setReferrerStatus({ db, actor: admin, referrerId: r.referrerId, status: "SUSPENDED" })).ok).toBe(true);
    expect(db.referrers[0].status).toBe("SUSPENDED");
    expect((await setReferrerStatus({ db, actor: admin, referrerId: r.referrerId, status: "BOGUS" as never })).ok).toBe(false);
  });
  it("cannot issue a code to a suspended referrer", async () => {
    const r = (await enrollReferrer({ db, actor: admin, clientCode: "CL-00001" })) as { ok: true; referrerId: string };
    await setReferrerStatus({ db, actor: admin, referrerId: r.referrerId, status: "SUSPENDED" });
    expect((await issueCode({ db, actor: admin, referrerId: r.referrerId })).ok).toBe(false);
  });
});

describe("rules: nothing exists by default and nothing is active until an Admin says so", () => {
  it("starts with no rules", () => expect(db.rules).toHaveLength(0));
  it("creates a rule inactive by default", async () => {
    const r = await saveRule({ db, actor: admin, input: form, activate: false, now: NOW });
    expect(r.ok).toBe(true);
    expect(db.rules[0]).toMatchObject({ active: false, fixedPaise: 10000 });
  });
  it("activating a rule with no start date starts it now, so past events are never paid by surprise", async () => {
    await saveRule({ db, actor: admin, input: form, activate: false, now: NOW });
    await setRuleActive({ db, actor: admin, ruleId: db.rules[0].id, active: true, now: NOW });
    expect(db.rules[0]).toMatchObject({ active: true, validFrom: NOW });
  });
  it("keeps an explicit start date, even a past one (a deliberate backdate)", async () => {
    const r = await saveRule({ db, actor: admin, input: { ...form, validFrom: "2026-12-01" }, activate: true, now: NOW });
    expect(r.ok).toBe(true);
    expect(db.rules[0].validFrom?.toISOString()).toBe("2026-11-30T18:30:00.000Z");
  });
  it("rejects invalid input and non-admins", async () => {
    expect((await saveRule({ db, actor: admin, input: { ...form, amountRupees: "x" }, activate: false, now: NOW })).ok).toBe(false);
    expect((await saveRule({ db, actor: { id: "f", role: "FINANCE" }, input: form, activate: false, now: NOW })).ok).toBe(false);
    expect((await setRuleActive({ db, actor: { id: "f", role: "FINANCE" }, ruleId: "x", active: true, now: NOW })).ok).toBe(false);
  });
  it("edits an existing rule", async () => {
    await saveRule({ db, actor: admin, input: form, activate: false, now: NOW });
    expect((await saveRule({ db, actor: admin, input: { ...form, amountRupees: "250" }, ruleId: db.rules[0].id, activate: false, now: NOW })).ok).toBe(true);
    expect(db.rules).toHaveLength(1);
    expect(db.rules[0].fixedPaise).toBe(25000);
  });
});

describe("saveSetting", () => {
  it("stores the disclaimer (trimmed, bounded) and a sane velocity limit", async () => {
    expect((await saveSetting({ db, actor: admin, key: "disclaimer", value: "  Terms apply.  " })).ok).toBe(true);
    expect(db.settings.get("disclaimer")).toBe("Terms apply.");
    expect((await saveSetting({ db, actor: admin, key: "disclaimer", value: "x".repeat(700) })).ok).toBe(false);
    expect((await saveSetting({ db, actor: admin, key: "velocity_limit", value: "8" })).ok).toBe(true);
    expect((await saveSetting({ db, actor: admin, key: "velocity_limit", value: "0" })).ok).toBe(false);
    expect((await saveSetting({ db, actor: admin, key: "other" as never, value: "1" })).ok).toBe(false);
    expect((await saveSetting({ db, actor: { id: "f", role: "FINANCE" }, key: "disclaimer", value: "Terms." })).ok).toBe(false);
  });
});
