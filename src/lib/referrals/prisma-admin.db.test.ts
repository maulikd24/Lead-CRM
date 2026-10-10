/**
 * Real-database test of the admin store and the admin services running on it: enrolment, codes, rules, settings and the
 * sign-off gate. Skipped unless REFERRAL_DB_TEST=1 (and refuses any non-local database):
 *   REFERRAL_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/referrals/prisma-admin.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.REFERRAL_DB_TEST === "1" && local;
const ADMIN = { id: "referral-admin-test-user", role: "ADMIN" };
const NOW = new Date("2027-01-10T10:00:00Z");

describe.skipIf(!enabled)("referral admin against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let clientId = "";
  let stageId = "";

  async function cleanup() {
    const refs = await db.referrer.findMany({ where: { client: { clientCode: { startsWith: "RA-" } } }, select: { id: true } });
    await db.referralCode.deleteMany({ where: { referrerId: { in: refs.map((r) => r.id) } } });
    await db.referrer.deleteMany({ where: { id: { in: refs.map((r) => r.id) } } });
    await db.rewardRule.deleteMany({ where: { createdById: ADMIN.id } });
    await db.referralSetting.deleteMany({ where: { updatedById: ADMIN.id } });
    await db.client.deleteMany({ where: { clientCode: { startsWith: "RA-" } } });
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    await cleanup();
    stageId = (await db.stage.findFirst())?.id ?? (await db.stage.create({ data: { name: "Referral admin stage", sequence: 9103, slaHours: 24 } })).id;
    clientId = (await db.client.create({ data: { clientCode: "RA-0001", name: "Admin Test", mobile: "9866100001", currentStageId: stageId } })).id;
    await db.client.create({ data: { clientCode: "RA-MERGED", name: "Merged Test", mobile: "9866100002", currentStageId: stageId, mergedIntoId: clientId } });
  });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  it("enrols a customer once, with one active code, and refuses merged records and repeats", async () => {
    const { enrollReferrer } = await import("./admin");
    const { prismaAdminStore: store } = await import("./prisma-admin");
    const first = await enrollReferrer({ db: store, actor: ADMIN, clientCode: "ra-0001" });
    expect(first.ok).toBe(true);
    expect(await db.referralCode.count({ where: { referrer: { clientId }, status: "ACTIVE" } })).toBe(1);
    expect(await enrollReferrer({ db: store, actor: ADMIN, clientCode: "RA-0001" })).toMatchObject({ ok: false, error: expect.stringMatching(/already a referrer/) });
    expect(await enrollReferrer({ db: store, actor: ADMIN, clientCode: "RA-MERGED" })).toMatchObject({ ok: false, error: expect.stringMatching(/merged/) });
    expect(await enrollReferrer({ db: store, actor: ADMIN, clientCode: "RA-NOPE" })).toMatchObject({ ok: false });
    expect(await db.referrer.count({ where: { client: { clientCode: { startsWith: "RA-" } } } })).toBe(1);
  });

  it("a colliding code is redrawn, and the unique index refuses a duplicate", async () => {
    const { issueCode } = await import("./admin");
    const { prismaAdminStore: store } = await import("./prisma-admin");
    const ref = await db.referrer.findFirstOrThrow({ where: { clientId }, include: { codes: true } });
    const taken = ref.codes[0].code;
    expect(await store.addCode(ref.id, taken)).toBe("code_taken");
    let calls = 0;
    const rng = (n: number) => { calls++; return CODE_INDEX_OF(taken, (calls - 1) % 8, n, calls > 8); };
    expect((await issueCode({ db: store, actor: ADMIN, referrerId: ref.id, rng })).ok).toBe(true);
    expect(calls).toBe(16); // the first draw collided, the second was kept
    expect(await db.referralCode.count({ where: { referrerId: ref.id } })).toBe(2);
  });

  it("revoking is compare-and-set: the second revoke of the same code reports it is already revoked", async () => {
    const { revokeCode } = await import("./admin");
    const { prismaAdminStore: store } = await import("./prisma-admin");
    const ref = await db.referrer.findFirstOrThrow({ where: { clientId }, include: { codes: { orderBy: { createdAt: "asc" } } } });
    const target = ref.codes[1];
    expect(await revokeCode({ db: store, actor: ADMIN, codeId: target.id, reason: "Shared publicly" })).toEqual({ ok: true });
    expect(await db.referralCode.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ status: "REVOKED", revokeReason: "Shared publicly", revokedById: ADMIN.id });
    expect(await revokeCode({ db: store, actor: ADMIN, codeId: target.id, reason: "Shared publicly" })).toMatchObject({ ok: false });
  });

  it("a suspended referrer cannot be issued a code; reactivating restores it", async () => {
    const { issueCode, setReferrerStatus } = await import("./admin");
    const { prismaAdminStore: store } = await import("./prisma-admin");
    const ref = await db.referrer.findFirstOrThrow({ where: { clientId } });
    expect((await setReferrerStatus({ db: store, actor: ADMIN, referrerId: ref.id, status: "SUSPENDED" })).ok).toBe(true);
    expect(await issueCode({ db: store, actor: ADMIN, referrerId: ref.id })).toMatchObject({ ok: false });
    expect((await setReferrerStatus({ db: store, actor: ADMIN, referrerId: ref.id, status: "ACTIVE" })).ok).toBe(true);
    expect((await setReferrerStatus({ db: store, actor: ADMIN, referrerId: "does-not-exist", status: "ACTIVE" })).ok).toBe(false);
  });

  it("rules start off, only switch on after the wording's sign-off, and a switch-on with no start date starts now", async () => {
    const { saveRule, setRuleActive, saveSetting, recordSignoff } = await import("./admin");
    const { prismaAdminStore: store } = await import("./prisma-admin");
    const form = { name: "DB KYC", event: "KYC_COMPLETE", kind: "FIXED", amountRupees: "100", maxRewardRupees: "", capPerMonthRupees: "", validFrom: "", validTo: "" };
    const saved = (await saveRule({ db: store, actor: ADMIN, input: form, activate: false, now: NOW })) as { ok: true; ruleId: string };
    expect(await db.rewardRule.findUniqueOrThrow({ where: { id: saved.ruleId } })).toMatchObject({ active: false, fixedPaise: 10000, validFrom: null });
    expect(await setRuleActive({ db: store, actor: ADMIN, ruleId: saved.ruleId, active: true, now: NOW })).toMatchObject({ ok: false });
    await saveSetting({ db: store, actor: ADMIN, key: "disclaimer", value: "Test wording." });
    expect(await recordSignoff({ db: store, actor: ADMIN, approverName: "A. Reviewer", now: NOW })).toMatchObject({ ok: false });
    expect(await recordSignoff({ db: store, actor: { id: "another-admin", role: "ADMIN" }, approverName: "A. Reviewer", now: NOW })).toEqual({ ok: true });
    expect(await setRuleActive({ db: store, actor: ADMIN, ruleId: saved.ruleId, active: true, now: NOW })).toEqual({ ok: true });
    expect(await db.rewardRule.findUniqueOrThrow({ where: { id: saved.ruleId } })).toMatchObject({ active: true, validFrom: NOW });
    expect(await setRuleActive({ db: store, actor: ADMIN, ruleId: "missing", active: false, now: NOW })).toMatchObject({ ok: false });
    expect((await saveRule({ db: store, actor: ADMIN, input: form, ruleId: "missing", activate: undefined, now: NOW })).ok).toBe(false);
  });

  it("settings are upserted and the editor is remembered", async () => {
    const { saveSetting } = await import("./admin");
    const { prismaAdminStore: store } = await import("./prisma-admin");
    expect((await saveSetting({ db: store, actor: ADMIN, key: "velocity_limit", value: "7" })).ok).toBe(true);
    expect((await saveSetting({ db: store, actor: ADMIN, key: "velocity_limit", value: "9" })).ok).toBe(true);
    expect(await store.getSetting("velocity_limit")).toBe("9");
    expect(await store.getSetting("disclaimer_editor")).toBe(ADMIN.id);
    expect(await store.getSetting("no_such_key")).toBeNull();
    await db.referralSetting.deleteMany({ where: { key: { in: ["disclaimer", "disclaimer_editor", "disclaimer_signoff", "velocity_limit"] } } });
  });
});

import { CODE_ALPHABET } from "./code";
/** The rng value that makes generateCode produce `target`'s character at `pos` (the first draw collides), or the next character when `shift` (a fresh code). */
function CODE_INDEX_OF(target: string, pos: number, n: number, shift: boolean): number {
  return (CODE_ALPHABET.indexOf(target[pos]) + (shift ? 1 : 0)) % n;
}
