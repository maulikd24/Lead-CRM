/**
 * Partner code versus customer referral code on the one signup webhook, end to end against a real database: the real route,
 * the real lead intake (which writes the partner's first touch), the real partner table behind the referral seam, and the
 * real referral store. Opt-in and local-only, like the other database tests:
 *   REFERRAL_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/app/api/webhooks/app-signup/route.precedence.db.test.ts
 */
import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.REFERRAL_DB_TEST === "1" && local;
const SECRET = "db-test-precedence-secret";
const PREFIX = "prec-";
const PARTNER_ONLY = "PTR-PREC1";
const BOTH = "BTH2K345"; // a partner's code that is also a customer's referral code (a collision, forced here)

describe.skipIf(!enabled)("partner code precedence on the signup webhook, real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let POST: (r: Request) => Promise<Response>;
  let partnerOnlyId = "";
  let bothPartnerId = "";
  let referrerId = "";

  const flags = (referral: boolean, partner: boolean) => {
    process.env.REFERRAL_PROGRAM_ENABLED = referral ? "1" : "0";
    process.env.PARTNER_WORKSPACE_ENABLED = partner ? "1" : "0";
  };
  const post = (payload: Record<string, unknown>) => {
    const raw = JSON.stringify({ name: "Precedence E2E", consentAt: new Date().toISOString(), ...payload });
    return POST(new Request("http://localhost/api/webhooks/app-signup", { method: "POST", headers: { "x-signature": createHmac("sha256", SECRET).update(raw).digest("hex"), "content-type": "application/json" }, body: raw }));
  };
  const claim = (userId: string) => import("@/lib/referrals/attribute").then(({ claimKey }) => db.referral.findUnique({ where: { idempotencyKey: claimKey(PREFIX + userId) } }));
  const customer = (mobile: string) => db.client.findFirstOrThrow({ where: { mobile } });
  const touch = async (mobile: string) => db.partnerReferralTouch.findUnique({ where: { clientId: (await customer(mobile)).id } });

  async function cleanup() {
    const clients = await db.client.findMany({ where: { OR: [{ mobile: { startsWith: "98772" } }, { clientCode: { startsWith: "PRC-" } }] }, select: { id: true } });
    const ids = clients.map((c) => c.id);
    const refs = await db.referrer.findMany({ where: { clientId: { in: ids } }, select: { id: true } });
    await db.referral.deleteMany({ where: { OR: [{ referrerId: { in: refs.map((r) => r.id) } }, { referredClientId: { in: ids } }, { referrerId: null, idempotencyKey: { startsWith: "allvest_app:" } }] } });
    await db.referralCode.deleteMany({ where: { referrerId: { in: refs.map((r) => r.id) } } });
    await db.referrer.deleteMany({ where: { id: { in: refs.map((r) => r.id) } } });
    await db.partnerReferralTouch.deleteMany({ where: { clientId: { in: ids } } });
    await db.partnerAttributionEvent.deleteMany({ where: { clientId: { in: ids } } });
    await db.leadIntake.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
    await db.activity.deleteMany({ where: { clientId: { in: ids } } }).catch(() => undefined);
    await db.stageHistory.deleteMany({ where: { clientId: { in: ids } } });
    await db.task.deleteMany({ where: { clientId: { in: ids } } }).catch(() => undefined);
    await db.client.deleteMany({ where: { id: { in: ids } } });
    await db.partnerProfile.deleteMany({ where: { partnerCode: { in: [PARTNER_ONLY, BOTH] } } });
    await db.user.deleteMany({ where: { email: { in: ["prec-partner1@example.test", "prec-partner2@example.test", "prec-admin@example.test"] } } });
  }

  beforeAll(async () => {
    process.env.APP_SIGNUP_SECRET = SECRET;
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    ({ POST } = await import("./route"));
    await (await import("@/lib/system/system-actor")).seedSystemActor();
    await cleanup();
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Precedence e2e stage", sequence: 9103, slaHours: 24 } }));
    const admin = await db.user.create({ data: { name: "Prec Admin", email: "prec-admin@example.test", passwordHash: "x", role: "ADMIN" } });
    const mk = async (email: string, code: string) => {
      const u = await db.user.create({ data: { name: "Prec Partner", email, passwordHash: "x", role: "PARTNER" } });
      return (await db.partnerProfile.create({ data: { userId: u.id, partnerCode: code, partnerType: "PARTNER", empanelmentStatus: "ACTIVE" } })).id;
    };
    partnerOnlyId = await mk("prec-partner1@example.test", PARTNER_ONLY);
    bothPartnerId = await mk("prec-partner2@example.test", BOTH);
    const owner = await db.client.create({ data: { clientCode: "PRC-OWNER", name: "Referrer Owner", mobile: "9877200001", mobileKey: "9877200001", currentStageId: stage.id } });
    const r = await db.referrer.create({ data: { clientId: owner.id, createdById: admin.id, codes: { create: [{ code: BOTH, createdAt: new Date("2020-01-01T00:00:00Z") }] } } });
    referrerId = r.id;
  });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  it("a partner's own code (both programmes on): the partner gets the first touch; no referral row, no rejected claim", async () => {
    flags(true, true);
    expect((await post({ userId: `${PREFIX}a`, mobile: "9877200002", referralCode: PARTNER_ONLY })).status).toBe(200);
    expect(await touch("9877200002")).toMatchObject({ partnerProfileId: partnerOnlyId, code: PARTNER_ONLY, source: "app" });
    expect(await claim("a")).toBeNull();
  });

  it("the partner's code in lower case with spaces is still the partner's", async () => {
    flags(true, true);
    expect((await post({ userId: `${PREFIX}a2`, mobile: "9877200003", referralCode: " ptr-prec1 " })).status).toBe(200);
    expect(await touch("9877200003")).toMatchObject({ partnerProfileId: partnerOnlyId });
    expect(await claim("a2")).toBeNull();
  });

  it("a code that is both: partner credited first touch AND the referral recorded, flagged for review", async () => {
    flags(true, true);
    expect((await post({ userId: `${PREFIX}b`, mobile: "9877200004", referralCode: BOTH })).status).toBe(200);
    expect(await touch("9877200004")).toMatchObject({ partnerProfileId: bothPartnerId, code: BOTH });
    const row = await claim("b");
    expect(row).toMatchObject({ outcome: "ATTRIBUTED", referrerId, flags: ["PARTNER_CODE_ALSO_PRESENT"] });
    expect(row?.referredClientId).toBe((await customer("9877200004")).id);
  });

  it("replaying the both-codes signup changes nothing: one touch, one referral, still flagged", async () => {
    flags(true, true);
    for (let i = 0; i < 3; i++) expect((await post({ userId: `${PREFIX}b`, mobile: "9877200004", referralCode: BOTH })).status).toBe(200);
    const id = (await customer("9877200004")).id;
    expect(await db.partnerReferralTouch.count({ where: { clientId: id } })).toBe(1);
    expect(await db.referral.count({ where: { referredClientId: id } })).toBe(1);
    expect((await claim("b"))?.flags).toEqual(["PARTNER_CODE_ALSO_PRESENT"]);
  });

  it("partner programme off, referral on: a partner-only code credits nobody and leaves no rejected consumer claim", async () => {
    flags(true, false);
    expect((await post({ userId: `${PREFIX}c`, mobile: "9877200005", referralCode: PARTNER_ONLY })).status).toBe(200);
    expect(await touch("9877200005")).toBeNull();
    expect(await claim("c")).toBeNull();
  });

  it("partner programme off, a both-codes signup is a plain referral with no partner flag and no touch", async () => {
    flags(true, false);
    expect((await post({ userId: `${PREFIX}d`, mobile: "9877200006", referralCode: BOTH })).status).toBe(200);
    expect(await touch("9877200006")).toBeNull();
    expect(await claim("d")).toMatchObject({ outcome: "ATTRIBUTED", flags: [] });
  });

  it("referral programme off, partner on: the partner still gets the touch and no referral row is written", async () => {
    flags(false, true);
    expect((await post({ userId: `${PREFIX}e`, mobile: "9877200007", referralCode: BOTH })).status).toBe(200);
    expect(await touch("9877200007")).toMatchObject({ partnerProfileId: bothPartnerId });
    expect(await claim("e")).toBeNull();
  });

  it("both programmes off: the signup is created and nothing about either programme is written", async () => {
    flags(false, false);
    expect((await post({ userId: `${PREFIX}f`, mobile: "9877200008", referralCode: BOTH })).status).toBe(200);
    expect(await touch("9877200008")).toBeNull();
    expect(await claim("f")).toBeNull();
    expect(await db.partnerAttributionEvent.count({ where: { clientId: (await customer("9877200008")).id } })).toBe(0);
  });

  it("the response is identical whichever programme owns the code (a code's owner never leaks)", async () => {
    flags(true, true);
    const bodies = [];
    for (const [i, code] of [PARTNER_ONLY, BOTH, "ZZZZ2222"].entries()) {
      const res = await post({ userId: `${PREFIX}g${i}`, mobile: `98772001${i}0`, referralCode: code });
      bodies.push([res.status, await res.json()]);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });
});
