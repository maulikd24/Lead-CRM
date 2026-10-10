/**
 * Clawbacks against a real database: the window is fixed on the reward when it accrues, a KYC or funding reversal inside
 * it appends a negative flagged entry (nothing is edited), it is recovered on a statement or waived by a person, and the
 * append-only trigger still holds. Skipped unless REFERRAL_DB_TEST=1 (and refuses any non-local database):
 *   REFERRAL_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/referrals/clawback.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.REFERRAL_DB_TEST === "1" && local;
const USER = "referral-clawback-test-user";
const DAY = 86_400_000;

describe.skipIf(!enabled)("referral clawbacks against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let referrerId = "";
  let referredId = "";

  async function cleanup() {
    const refs = await db.referrer.findMany({ where: { client: { clientCode: { startsWith: "RC-" } } }, select: { id: true } });
    const ids = refs.map((r) => r.id);
    await db.rewardStatement.deleteMany({ where: { referrerId: { in: ids } } });
    await db.rewardLedgerEntry.deleteMany({ where: { referrerId: { in: ids } } });
    await db.referral.deleteMany({ where: { OR: [{ referrerId: { in: ids } }, { referredClient: { clientCode: { startsWith: "RC-" } } }, { referrerId: null, idempotencyKey: { startsWith: "allvest_app:" } }] } });
    await db.referralCode.deleteMany({ where: { referrerId: { in: ids } } });
    await db.referrer.deleteMany({ where: { id: { in: ids } } });
    await db.rewardRule.deleteMany({ where: { createdById: USER } });
    const cl = await db.client.findMany({ where: { clientCode: { startsWith: "RC-" } }, select: { id: true } });
    await db.kycRecord.deleteMany({ where: { clientId: { in: cl.map((c) => c.id) } } });
    await db.fundingRecord.deleteMany({ where: { clientId: { in: cl.map((c) => c.id) } } });
    await db.client.deleteMany({ where: { clientCode: { startsWith: "RC-" } } });
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    await cleanup();
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Referral clawback stage", sequence: 9104, slaHours: 24 } }));
    await db.user.upsert({ where: { id: USER }, update: {}, create: { id: USER, name: "Clawback Test", email: "referral-clawback@example.test", passwordHash: "x", role: "ADMIN" } });
    const owner = await db.client.create({ data: { clientCode: "RC-OWNER", name: "Clawback Owner", mobile: "9855100001", currentStageId: stage.id } });
    referrerId = (await db.referrer.create({ data: { clientId: owner.id, createdById: USER, codes: { create: { code: "CWBK2345", createdAt: new Date("2020-01-01T00:00:00Z") } } } })).id;
    referredId = (await db.client.create({ data: { clientCode: "RC-NEW", name: "Clawback Newcomer", mobile: "9855100002", currentStageId: stage.id } })).id;
    const start = new Date("2020-01-01T00:00:00Z");
    await db.rewardRule.create({ data: { name: "KYC", event: "KYC_COMPLETE", kind: "FIXED", fixedPaise: 10000, clawbackDays: 30, active: true, validFrom: start, createdById: USER } });
    await db.rewardRule.create({ data: { name: "Funding", event: "FIRST_FUNDING", kind: "PERCENT", percentBps: 100, clawbackDays: 60, active: true, validFrom: start, createdById: USER } });
  });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.user.deleteMany({ where: { id: USER } });
      await db.$disconnect();
    }
  });

  const ledger = () => db.rewardLedgerEntry.findMany({ where: { referrerId }, orderBy: { createdAt: "asc" } });

  it("fixes the end of each window on the reward when it accrues", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { attributeSignup } = await import("./attribute");
    const { refreshProgress } = await import("./refresh");
    expect(await attributeSignup({ store, userId: "rc-u1", referralCode: "CWBK2345", outcome: { status: "created", clientId: referredId }, signedUpAt: new Date() })).toEqual({ status: "attributed" });
    const kycAt = new Date(Date.now() - 3 * DAY);
    const fundAt = new Date(Date.now() - 2 * DAY);
    await db.kycRecord.create({ data: { clientId: referredId, status: "APPROVED", completionDate: kycAt } });
    await db.fundingRecord.create({ data: { clientId: referredId, status: "FULLY_FUNDED", amount: "500000", fundingDate: fundAt } });
    await refreshProgress({ store, now: new Date() });
    const rows = await ledger();
    const kyc = rows.find((r) => r.eventType === "KYC_COMPLETE")!;
    const fund = rows.find((r) => r.eventType === "FIRST_FUNDING")!;
    expect(kyc.clawbackUntil?.getTime()).toBe(kycAt.getTime() + 30 * DAY);
    expect(fund.clawbackUntil?.getTime()).toBe(fundAt.getTime() + 60 * DAY);
  });

  it("pays it through a statement (approved by someone else) before anything is reversed", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { approveStatement, markStatementPaid, prepareStatement } = await import("./statements");
    const { monthKeyIST } = await import("./rewards");
    const period = monthKeyIST(new Date());
    const prep = await prepareStatement({ store, actor: { id: USER, role: "ADMIN" }, referrerId, period });
    expect(prep).toMatchObject({ ok: true, totalPaise: 510000 });
    const id = (prep as { statementId: string }).statementId;
    expect((await approveStatement({ store, actor: { id: "someone-else", role: "FINANCE" }, statementId: id })).ok).toBe(true);
    expect((await markStatementPaid({ store, actor: { id: "someone-else", role: "FINANCE" }, statementId: id, bankReference: "UTR2027015550001" })).ok).toBe(true);
  });

  it("KYC revoked inside the window: a negative, flagged entry is appended, the paid reward row is untouched, and a second run adds nothing", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { refreshProgress } = await import("./refresh");
    const { accrualStates } = await import("./ledger");
    const before = (await ledger()).find((r) => r.eventType === "KYC_COMPLETE" && r.kind === "ACCRUED")!;
    await db.kycRecord.update({ where: { clientId: referredId }, data: { status: "REJECTED", rejectionReason: "Document mismatch (test)" } });
    const out = await refreshProgress({ store, now: new Date() });
    expect(out).toMatchObject({ clawbacks: 1, failed: 0 });
    const rows = await ledger();
    const claw = rows.find((r) => r.kind === "CLAWBACK")!;
    expect(claw).toMatchObject({ amountPaise: -10000, refEntryId: before.id, flags: ["CLAWBACK_KYC_REVOKED"], referralId: before.referralId });
    expect(rows.find((r) => r.id === before.id)).toEqual(before);
    expect(accrualStates(await store.ledgerForReferrer(referrerId)).get(before.id)).toBe("CLAWED_BACK");
    expect(await refreshProgress({ store, now: new Date() })).toMatchObject({ clawbacks: 0 });
    expect((await ledger()).filter((r) => r.kind === "CLAWBACK")).toHaveLength(1);
  });

  it("the recovery cannot be paid out of nothing: the next statement is refused and the balance carries forward", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { prepareStatement } = await import("./statements");
    const { monthKeyIST } = await import("./rewards");
    // This month's statement is already approved (one per referrer per month), so the recovery waits for the next month's.
    expect(await prepareStatement({ store, actor: { id: USER, role: "ADMIN" }, referrerId, period: monthKeyIST(new Date()) })).toMatchObject({ ok: false, error: expect.stringMatching(/already approved/i) });
    const r = await prepareStatement({ store, actor: { id: USER, role: "ADMIN" }, referrerId, period: monthKeyIST(new Date(Date.now() + 33 * DAY)) });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/carries forward/i) });
  });

  it("a person can confirm it or waive it; a waiver is a positive entry and is final", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { waiveClawback, confirmClawback } = await import("./statements");
    const { refreshProgress } = await import("./refresh");
    const claw = (await ledger()).find((r) => r.kind === "CLAWBACK")!;
    expect((await confirmClawback({ store, actor: { id: USER, role: "ADMIN" }, referrerId, entryId: claw.id, note: "Checked: KYC was rejected" })).ok).toBe(true);
    expect((await waiveClawback({ store, actor: { id: USER, role: "ADMIN" }, referrerId, entryId: claw.id, reason: "KYC was re-approved on appeal" })).ok).toBe(true);
    const waiver = (await ledger()).find((r) => r.kind === "CLAWBACK_WAIVED")!;
    expect(waiver).toMatchObject({ amountPaise: 10000, refEntryId: claw.id });
    expect(await refreshProgress({ store, now: new Date() })).toMatchObject({ clawbacks: 0 });
    expect((await ledger()).filter((r) => r.kind === "CLAWBACK")).toHaveLength(1);
  });

  it("funding reversed inside its window takes the funding reward back", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { refreshProgress } = await import("./refresh");
    await db.fundingRecord.update({ where: { clientId: referredId }, data: { status: "NOT_PROCEEDING" } });
    expect(await refreshProgress({ store, now: new Date() })).toMatchObject({ clawbacks: 1 });
    const claw = (await ledger()).filter((r) => r.kind === "CLAWBACK").find((r) => r.eventType === "FIRST_FUNDING")!;
    expect(claw).toMatchObject({ amountPaise: -500000, flags: ["CLAWBACK_FUNDING_REVERSED"] });
  });

  it("the ledger is still append-only: a clawback row cannot be updated", async () => {
    const claw = (await ledger()).find((r) => r.kind === "CLAWBACK")!;
    await expect(db.rewardLedgerEntry.update({ where: { id: claw.id }, data: { amountPaise: 0 } })).rejects.toThrow(/append-only/i);
  });
});
