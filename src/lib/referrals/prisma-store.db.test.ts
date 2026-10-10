/**
 * Real-database test of the referral store: attribution, progress from the KYC and funding records, accrual, caps, review,
 * statements and the append-only trigger. Needs a throwaway local Postgres, so it is skipped unless REFERRAL_DB_TEST=1 (and refuses any non-local database):
 *   REFERRAL_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/referrals/prisma-store.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.REFERRAL_DB_TEST === "1" && local;

describe.skipIf(!enabled)("referral programme against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let referrerId = "";
  let newClientId = "";
  let ownerId = "";
  const CODE = "ZZRF2345";

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    await cleanup();
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Referral test stage", sequence: 9101, slaHours: 24 } }));
    const user = await db.user.upsert({ where: { id: "referral-test-admin" }, update: {}, create: { id: "referral-test-admin", name: "Referral Admin", email: "referral-admin@example.test", passwordHash: "x", role: "ADMIN" } });
    const owner = await db.client.create({ data: { clientCode: "RF-OWNER", name: "Referral Owner", mobile: "9811100001", currentStageId: stage.id } });
    ownerId = owner.id;
    const referrer = await db.referrer.create({ data: { clientId: owner.id, createdById: user.id, codes: { create: { code: CODE, createdAt: new Date("2020-01-01T00:00:00Z") } } } });
    referrerId = referrer.id;
    const fresh = await db.client.create({ data: { clientCode: "RF-NEW", name: "Referral Newcomer", mobile: "9811100002", currentStageId: stage.id } });
    newClientId = fresh.id;
    await db.rewardRule.create({ data: { name: "KYC", event: "KYC_COMPLETE", kind: "FIXED", fixedPaise: 10000, capPerReferrerMonthPaise: 15000, active: true, validFrom: new Date("2020-01-01T00:00:00Z"), createdById: user.id } });
    await db.rewardRule.create({ data: { name: "Funding", event: "FIRST_FUNDING", kind: "PERCENT", percentBps: 100, active: true, validFrom: new Date("2020-01-01T00:00:00Z"), createdById: user.id } });
  });

  async function cleanup() {
    await db.rewardStatement.deleteMany({ where: { preparedById: "referral-test-admin" } });
    const refs = await db.referrer.findMany({ where: { client: { clientCode: { startsWith: "RF-" } } }, select: { id: true } });
    const ids = refs.map((r) => r.id);
    await db.rewardLedgerEntry.deleteMany({ where: { referrerId: { in: ids } } });
    await db.referral.deleteMany({ where: { OR: [{ referrerId: { in: ids } }, { referredClient: { clientCode: { startsWith: "RF-" } } }, { idempotencyKey: { startsWith: "allvest_app:" }, referrerId: null }] } });
    await db.referralCode.deleteMany({ where: { referrerId: { in: ids } } });
    await db.referrer.deleteMany({ where: { id: { in: ids } } });
    await db.rewardRule.deleteMany({ where: { createdById: "referral-test-admin" } });
    const cl = await db.client.findMany({ where: { clientCode: { startsWith: "RF-" } }, select: { id: true } });
    await db.kycRecord.deleteMany({ where: { clientId: { in: cl.map((c) => c.id) } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: cl.map((c) => c.id) } } });
    await db.client.deleteMany({ where: { clientCode: { startsWith: "RF-" } } });
  }
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  it("credits a new signup, once, and blocks self-referral and a known customer", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { attributeSignup } = await import("./attribute");
    const at = new Date();
    expect(await attributeSignup({ store, userId: "rf-u1", referralCode: "zzrf-2345", outcome: { status: "created", clientId: newClientId }, signedUpAt: at })).toEqual({ status: "attributed" });
    expect(await attributeSignup({ store, userId: "rf-u1", referralCode: CODE, outcome: { status: "created", clientId: newClientId }, signedUpAt: at })).toEqual({ status: "replay" });
    expect(await attributeSignup({ store, userId: "rf-u2", referralCode: CODE, outcome: { status: "duplicate", clientId: ownerId }, signedUpAt: at })).toEqual({ status: "rejected", reason: "SELF_REFERRAL" });
    expect(await db.referral.count({ where: { referrerId, outcome: "ATTRIBUTED" } })).toBe(1);
    expect(await db.referralEvent.count({ where: { referral: { referrerId } } })).toBe(1);
    expect(await db.referral.count({ where: { idempotencyKey: { contains: "rf-u1" } } })).toBe(0); // the app user id is hashed
  });

  it("records KYC and funding from the customer's own records, accrues by rule with the cap, and is idempotent", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { refreshProgress } = await import("./refresh");
    await db.kycRecord.create({ data: { clientId: newClientId, status: "APPROVED", completionDate: new Date() } });
    await db.fundingRecord.create({ data: { clientId: newClientId, status: "FULLY_FUNDED", amount: "500000", fundingDate: new Date() } });
    const first = await refreshProgress({ store, now: new Date() });
    expect(first).toMatchObject({ eventsRecorded: 2 });
    const rows = await db.rewardLedgerEntry.findMany({ where: { referrerId }, orderBy: { amountPaise: "asc" } });
    // KYC 100.00 (under the 150.00 monthly cap) and 1% of 5,00,000 = 5,000.00; the cap rule is on KYC only, so both are untrimmed.
    expect(rows.map((r) => r.amountPaise)).toEqual([10000, 500000]);
    const second = await refreshProgress({ store, now: new Date() });
    expect(second).toMatchObject({ eventsRecorded: 0, entriesAccrued: 0 });
    expect(await db.rewardLedgerEntry.count({ where: { referrerId } })).toBe(2);
  });

  it("runs the statement workflow with four eyes and writes append-only entries", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { prepareStatement, approveStatement, markStatementPaid } = await import("./statements");
    const { monthKeyIST } = await import("./rewards");
    const period = monthKeyIST(new Date());
    const prep = await prepareStatement({ store, actor: { id: "referral-test-admin", role: "ADMIN" }, referrerId, period });
    expect(prep).toMatchObject({ ok: true, totalPaise: 510000 });
    const id = (prep as { statementId: string }).statementId;
    expect((await approveStatement({ store, actor: { id: "referral-test-admin", role: "ADMIN" }, statementId: id })).ok).toBe(false);
    expect((await approveStatement({ store, actor: { id: "someone-else", role: "FINANCE" }, statementId: id })).ok).toBe(true);
    expect((await approveStatement({ store, actor: { id: "someone-else", role: "FINANCE" }, statementId: id })).ok).toBe(false);
    expect((await markStatementPaid({ store, actor: { id: "someone-else", role: "FINANCE" }, statementId: id, bankReference: "UTR2027011234567" })).ok).toBe(true);
    expect(await db.rewardLedgerEntry.count({ where: { referrerId, kind: "PAID_MARKED" } })).toBe(2);
    const st = await db.rewardStatement.findUniqueOrThrow({ where: { id } });
    expect(st).toMatchObject({ status: "PAID", bankReference: "UTR2027011234567", approvedById: "someone-else" });
  });

  it("the ledger refuses UPDATE (append-only) but allows DELETE (erasure)", async () => {
    const row = await db.rewardLedgerEntry.findFirstOrThrow({ where: { referrerId } });
    await expect(db.rewardLedgerEntry.update({ where: { id: row.id }, data: { amountPaise: 1 } })).rejects.toThrow(/append-only/i);
    await expect(db.rewardLedgerEntry.delete({ where: { id: row.id } })).resolves.toBeTruthy();
  });
});
