/**
 * The signup webhook with the referral hook, the real lead intake and a real database, end to end: a signed payload goes
 * in, a customer, a claim and an event come out; replays change nothing; and the scheduled job heals a signup whose hook
 * never ran by reading the signup ledger. Needs a throwaway local Postgres, so it is skipped unless REFERRAL_DB_TEST=1
 * (and refuses any non-local database):
 *   REFERRAL_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/app/api/webhooks/app-signup/route.referral.db.test.ts
 */
import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Outside a request there is no session: the data-change capture simply records no actor.
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.REFERRAL_DB_TEST === "1" && local;
const SECRET = "db-test-signup-secret";
const PREFIX = "rfe2e-";
const CODE = "RFX2K345";

describe.skipIf(!enabled)("app-signup webhook and the referral programme against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let POST: (r: Request) => Promise<Response>;
  let referrerId = "";
  let referrerClientId = "";

  const post = (payload: Record<string, unknown>, signature?: string) => {
    const raw = JSON.stringify({ name: "Referral E2E", consentAt: new Date().toISOString(), ...payload });
    return POST(new Request("http://localhost/api/webhooks/app-signup", { method: "POST", headers: { "x-signature": signature ?? createHmac("sha256", SECRET).update(raw).digest("hex"), "content-type": "application/json" }, body: raw }));
  };
  const claims = (userId: string) => import("@/lib/referrals/attribute").then(({ claimKey }) => db.referral.findUnique({ where: { idempotencyKey: claimKey(PREFIX + userId) } }));

  async function cleanup() {
    const clients = await db.client.findMany({ where: { OR: [{ mobile: { startsWith: "98771" } }, { clientCode: { startsWith: "RFE-" } }] }, select: { id: true } });
    const ids = clients.map((c) => c.id);
    const refs = await db.referrer.findMany({ where: { clientId: { in: ids } }, select: { id: true } });
    await db.rewardLedgerEntry.deleteMany({ where: { referrerId: { in: refs.map((r) => r.id) } } });
    await db.referral.deleteMany({ where: { OR: [{ referrerId: { in: refs.map((r) => r.id) } }, { referredClientId: { in: ids } }, { referrerId: null, idempotencyKey: { startsWith: "allvest_app:" } }] } });
    await db.referralCode.deleteMany({ where: { referrerId: { in: refs.map((r) => r.id) } } });
    await db.referrer.deleteMany({ where: { id: { in: refs.map((r) => r.id) } } });
    await db.leadIntake.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
    await db.activity.deleteMany({ where: { clientId: { in: ids } } }).catch(() => undefined);
    await db.stageHistory.deleteMany({ where: { clientId: { in: ids } } });
    await db.task.deleteMany({ where: { clientId: { in: ids } } }).catch(() => undefined);
    await db.client.deleteMany({ where: { id: { in: ids } } });
    await db.user.deleteMany({ where: { id: "referral-e2e-admin" } });
  }

  beforeAll(async () => {
    process.env.APP_SIGNUP_SECRET = SECRET;
    process.env.REFERRAL_PROGRAM_ENABLED = "1";
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    ({ POST } = await import("./route"));
    await (await import("@/lib/system/system-actor")).seedSystemActor();
    await cleanup();
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Referral e2e stage", sequence: 9102, slaHours: 24 } }));
    const user = await db.user.create({ data: { id: "referral-e2e-admin", name: "Referral E2E Admin", email: "referral-e2e@example.test", passwordHash: "x", role: "ADMIN" } });
    const owner = await db.client.create({ data: { clientCode: "RFE-OWNER", name: "Referrer Owner", mobile: "9877100001", mobileKey: "9877100001", currentStageId: stage.id } });
    referrerClientId = owner.id;
    const referrer = await db.referrer.create({ data: { clientId: owner.id, createdById: user.id, codes: { create: [{ code: CODE, createdAt: new Date("2020-01-01T00:00:00Z") }, { code: "RVKD2345", status: "REVOKED", createdAt: new Date("2020-01-01T00:00:00Z"), revokedAt: new Date("2020-06-01T00:00:00Z") }] } } });
    referrerId = referrer.id;
  });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  it("a signed signup with a code creates the customer, credits the referrer once and writes the SIGNED_UP event", async () => {
    const res = await post({ userId: `${PREFIX}1`, mobile: "9877100002", referralCode: CODE });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "created" });
    const row = await claims("1");
    expect(row).toMatchObject({ outcome: "ATTRIBUTED", referrerId });
    const customer = await db.client.findFirstOrThrow({ where: { mobile: "9877100002" } });
    expect(row?.referredClientId).toBe(customer.id);
    expect(await db.referralEvent.count({ where: { referralId: row!.id, type: "SIGNED_UP" } })).toBe(1);
    expect(row?.idempotencyKey).not.toContain(`${PREFIX}1`);
  });

  it("the same signed body replayed (the app retries) changes nothing", async () => {
    const raw = { userId: `${PREFIX}1`, mobile: "9877100002", referralCode: CODE };
    for (let i = 0; i < 3; i++) expect((await post(raw)).status).toBe(200);
    expect(await db.referral.count({ where: { referrerId, outcome: "ATTRIBUTED" } })).toBe(1);
    expect(await db.client.count({ where: { mobile: "9877100002" } })).toBe(1);
  });

  it("a bad signature is refused before anything is created", async () => {
    const res = await post({ userId: `${PREFIX}bad`, mobile: "9877100003", referralCode: CODE }, "00".repeat(32));
    expect(res.status).toBe(401);
    expect(await db.client.count({ where: { mobile: "9877100003" } })).toBe(0);
    expect(await claims("bad")).toBeNull();
  });

  it("unknown and revoked codes are recorded as rejected with no person attached, and the signup still succeeds", async () => {
    expect((await post({ userId: `${PREFIX}unk`, mobile: "9877100004", referralCode: "NOPE2345" })).status).toBe(200);
    expect((await post({ userId: `${PREFIX}rev`, mobile: "9877100005", referralCode: "RVKD2345" })).status).toBe(200);
    expect(await claims("unk")).toMatchObject({ outcome: "REJECTED", reason: "UNKNOWN_CODE", referredClientId: null });
    expect(await claims("rev")).toMatchObject({ outcome: "REJECTED", reason: "CODE_REVOKED", referredClientId: null });
  });

  it("self-referral: the referrer's own phone with their own code is rejected", async () => {
    expect((await post({ userId: `${PREFIX}self`, mobile: "9877100001", referralCode: CODE })).status).toBe(200);
    expect(await claims("self")).toMatchObject({ outcome: "REJECTED", reason: "SELF_REFERRAL" });
  });

  it("a person who is already a customer (duplicate) is not credited", async () => {
    const stage = await db.stage.findFirstOrThrow();
    await db.client.create({ data: { clientCode: "RFE-OLD", name: "Existing Customer", mobile: "9877100006", mobileKey: "9877100006", currentStageId: stage.id } });
    expect((await post({ userId: `${PREFIX}dup`, mobile: "9877100006", referralCode: CODE })).status).toBe(200);
    expect(await claims("dup")).toMatchObject({ outcome: "REJECTED", reason: "ALREADY_CUSTOMER", referredClientId: null });
  });

  it("the cron job credits a signup whose hook never ran, from the signup ledger, once", async () => {
    process.env.REFERRAL_PROGRAM_ENABLED = "0";
    expect((await post({ userId: `${PREFIX}missed`, mobile: "9877100007", referralCode: CODE })).status).toBe(200);
    expect(await claims("missed")).toBeNull();
    process.env.REFERRAL_PROGRAM_ENABLED = "1";
    const { runReferralJob } = await import("@/lib/referrals/job");
    const first = await runReferralJob();
    expect(first).toMatchObject({ reattributed: expect.any(Number), failed: 0 });
    const row = await claims("missed");
    expect(row).toMatchObject({ outcome: "ATTRIBUTED", referrerId });
    const second = await runReferralJob();
    expect(second).toMatchObject({ reattributed: 0, failed: 0 });
    expect(await db.referral.count({ where: { referrerId, outcome: "ATTRIBUTED" } })).toBe(2);
  });

  it("the job ignores a ledger row for a signup that was rejected or has no code", async () => {
    expect((await post({ userId: `${PREFIX}nocode`, mobile: "9877100008" })).status).toBe(200);
    const { runReferralJob } = await import("@/lib/referrals/job");
    await runReferralJob();
    expect(await claims("nocode")).toBeNull();
    expect(referrerClientId).toBeTruthy();
  });
});
