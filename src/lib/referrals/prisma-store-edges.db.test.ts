/**
 * Edges of the referral store that the services never exercise on their own: compare-and-set statement steps under a race,
 * which referrals are still watched for clawbacks, the scoping of accrual keys, and what a rejected claim may keep. Needs a
 * throwaway local Postgres, so it is skipped unless REFERRAL_DB_TEST=1 (and refuses any non-local database):
 *   REFERRAL_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/referrals/prisma-store-edges.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.REFERRAL_DB_TEST === "1" && local;
const USER = "referral-edges-test-user";
const DAY = 86_400_000;

describe.skipIf(!enabled)("referral store edges against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let referrerId = "";
  let referralA = "";
  let referralB = "";

  async function cleanup() {
    const cl = await db.client.findMany({ where: { clientCode: { startsWith: "RE-" } }, select: { id: true } });
    const ids = cl.map((c) => c.id);
    const refs = await db.referrer.findMany({ where: { clientId: { in: ids } }, select: { id: true } });
    const r = refs.map((x) => x.id);
    await db.rewardStatement.deleteMany({ where: { referrerId: { in: r } } });
    await db.rewardLedgerEntry.deleteMany({ where: { referrerId: { in: r } } });
    await db.referral.deleteMany({ where: { OR: [{ referrerId: { in: r } }, { referredClientId: { in: ids } }, { referrerId: null, idempotencyKey: { startsWith: "allvest_app:" } }] } });
    await db.referralCode.deleteMany({ where: { referrerId: { in: r } } });
    await db.referrer.deleteMany({ where: { id: { in: r } } });
    await db.client.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    await cleanup();
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Referral edges stage", sequence: 9106, slaHours: 24 } }));
    await db.user.upsert({ where: { id: USER }, update: {}, create: { id: USER, name: "Edges Test", email: "referral-edges@example.test", passwordHash: "x", role: "ADMIN" } });
    const owner = await db.client.create({ data: { clientCode: "RE-OWNER", name: "Edges Owner", mobile: "9833100001", currentStageId: stage.id } });
    referrerId = (await db.referrer.create({ data: { clientId: owner.id, createdById: USER, codes: { create: { code: "EDGE2345", createdAt: new Date("2020-01-01T00:00:00Z") } } } })).id;
    const a = await db.client.create({ data: { clientCode: "RE-A", name: "Edges A", mobile: "9833100002", currentStageId: stage.id } });
    const b = await db.client.create({ data: { clientCode: "RE-B", name: "Edges B", mobile: "9833100003", currentStageId: stage.id } });
    referralA = (await db.referral.create({ data: { idempotencyKey: "edges-a", referrerId, referredClientId: a.id, outcome: "ATTRIBUTED" } })).id;
    referralB = (await db.referral.create({ data: { idempotencyKey: "edges-b", referrerId, referredClientId: b.id, outcome: "ATTRIBUTED" } })).id;
  });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.user.deleteMany({ where: { id: USER } });
      await db.$disconnect();
    }
  });

  const entry = (key: string, referralId: string, over: Record<string, unknown> = {}) => ({ idempotencyKey: key, kind: "ACCRUED" as const, referrerId, referralId, eventType: "KYC_COMPLETE" as const, ruleId: null, refEntryId: null, statementId: null, amountPaise: 10000, periodMonth: "2027-01", flags: [], note: null, actorId: null, ...over });

  it("a referrer's ledger holds that referrer's entries and nobody else's", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const stage = await db.stage.findFirstOrThrow();
    const other = await db.client.create({ data: { clientCode: "RE-OTHER", name: "Edges Other", mobile: "9833100009", currentStageId: stage.id } });
    const otherReferrer = (await db.referrer.create({ data: { clientId: other.id, createdById: USER, codes: { create: { code: "EDGE3456", createdAt: new Date("2020-01-01T00:00:00Z") } } } })).id;
    await store.appendEntries([entry("scope-mine", referralA), entry("scope-theirs", referralA, { referrerId: otherReferrer })]);
    const mine = await store.ledgerForReferrer(referrerId);
    expect(mine.every((e) => e.referrerId === referrerId)).toBe(true);
    expect(mine.length).toBeGreaterThan(0);
    expect((await store.ledgerForReferrer(otherReferrer)).map((e) => e.referrerId)).toEqual([otherReferrer]);
  });

  it("a statement step is compare-and-set: of two racing approvals exactly one wins and writes its ledger lines once", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const st = await store.upsertPreparedStatement({ referrerId, period: "2027-01", totalPaise: 10000, lines: [{ entryId: "x", amountPaise: 10000, periodMonth: "2027-01" }], preparedById: "preparer" });
    const step = (key: string) => store.advanceStatement(st.id, "PREPARED", { status: "APPROVED", approvedById: "approver" }, [entry(key, referralA, { kind: "APPROVED", statementId: st.id })]);
    const results = await Promise.all([step("race-1"), step("race-2")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.rewardLedgerEntry.count({ where: { kind: "APPROVED", statementId: st.id } })).toBe(1);
    expect(await step("race-3")).toBe(false); // already approved: nothing moves, nothing is written
    expect(await db.rewardLedgerEntry.count({ where: { kind: "APPROVED", statementId: st.id } })).toBe(1);
  });

  it("only referrals with a reward whose clawback window is still open (or closed within the grace period) are watched", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const now = Date.now();
    await store.appendEntries([entry("w-open", referralA, { clawbackUntil: new Date(now + 10 * DAY) }), entry("w-old", referralB, { clawbackUntil: new Date(now - 30 * DAY) })]);
    const watched = await store.referralsWithOpenClawback(new Date(now - 7 * DAY));
    expect(watched.has(referralA)).toBe(true);
    expect(watched.has(referralB)).toBe(false);
    expect((await store.referralsWithOpenClawback(new Date(now - 60 * DAY))).has(referralB)).toBe(true);
  });

  it("accrual keys belong to one referral and never leak to another", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    await store.appendEntries([entry(`accrue:${referralA}:KYC_COMPLETE:r1`, referralA), entry(`accrue:${referralB}:KYC_COMPLETE:r1`, referralB)]);
    expect([...(await store.accrualKeys(referralA))]).toEqual([`accrue:${referralA}:KYC_COMPLETE:r1`]);
    expect([...(await store.accrualKeys(referralB))]).toEqual([`accrue:${referralB}:KYC_COMPLETE:r1`]);
  });

  it("a rejected claim never keeps a device, even if one is handed to the store", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    expect(await store.saveClaim({ key: "edges-rejected", referrerId, codeId: null, referredClientId: null, outcome: "REJECTED", reason: "UNKNOWN_CODE", attributedAt: new Date(), flags: [], deviceHash: "f".repeat(64) })).toBe("saved");
    expect((await db.referral.findUniqueOrThrow({ where: { idempotencyKey: "edges-rejected" } })).deviceHash).toBeNull();
  });
});
