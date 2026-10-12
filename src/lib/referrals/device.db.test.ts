/**
 * Hashed-device abuse signals and partner-code flags against a real database. Needs a throwaway local Postgres, so it is
 * skipped unless REFERRAL_DB_TEST=1 (and refuses any non-local database):
 *   REFERRAL_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/referrals/device.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: async () => null }));

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.REFERRAL_DB_TEST === "1" && local;
const USER = "referral-device-test-user";
const D = (c: string) => c.repeat(64);

describe.skipIf(!enabled)("referral device signals and flags against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  const ids: Record<string, string> = {};

  async function cleanup() {
    const cl = await db.client.findMany({ where: { clientCode: { startsWith: "RD-" } }, select: { id: true } });
    const clientIds = cl.map((c) => c.id);
    const refs = await db.referrer.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } });
    const r = refs.map((x) => x.id);
    await db.rewardLedgerEntry.deleteMany({ where: { referrerId: { in: r } } });
    await db.referral.deleteMany({ where: { OR: [{ referrerId: { in: r } }, { referredClientId: { in: clientIds } }, { referrerId: null, idempotencyKey: { startsWith: "allvest_app:" } }] } });
    await db.referralCode.deleteMany({ where: { referrerId: { in: r } } });
    await db.referrer.deleteMany({ where: { id: { in: r } } });
    await db.rewardRule.deleteMany({ where: { createdById: USER } });
    await db.referralDevice.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.kycRecord.deleteMany({ where: { clientId: { in: clientIds } } });
    await db.client.deleteMany({ where: { id: { in: clientIds } } });
  }

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    await cleanup();
    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Referral device stage", sequence: 9105, slaHours: 24 } }));
    await db.user.upsert({ where: { id: USER }, update: {}, create: { id: USER, name: "Device Test", email: "referral-device@example.test", passwordHash: "x", role: "ADMIN" } });
    let n = 0;
    const mk = async (code: string) => (ids[code] = (await db.client.create({ data: { clientCode: `RD-${code}`, name: `Device ${code}`, mobile: `98441${String(++n).padStart(5, "0")}`, currentStageId: stage.id } })).id);
    for (const c of ["R1", "R2", "A", "B", "C"]) await mk(c);
    for (const [c, code] of [["R1", "DVC32345"], ["R2", "DVC22345"]] as const) {
      await db.referrer.create({ data: { clientId: ids[c], createdById: USER, codes: { create: { code, createdAt: new Date("2020-01-01T00:00:00Z") } } } });
    }
    await db.rewardRule.create({ data: { name: "KYC", event: "KYC_COMPLETE", kind: "FIXED", fixedPaise: 10000, active: true, validFrom: new Date("2020-01-01T00:00:00Z"), createdById: USER } });
  });
  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.user.deleteMany({ where: { id: USER } });
      await db.$disconnect();
    }
  });

  const flagsOf = async (clientCode: string) => {
    const e = await db.rewardLedgerEntry.findFirst({ where: { kind: "ACCRUED", referralId: (await db.referral.findFirstOrThrow({ where: { referredClientId: ids[clientCode] } })).id } });
    return e?.flags ?? null;
  };

  it("remembers a hashed device once per customer, however often it is reported", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    await store.recordDevice(ids.R1, D("1"));
    await store.recordDevice(ids.R1, D("1"));
    await store.recordDevice(ids.R1, D("2"));
    expect(await db.referralDevice.count({ where: { clientId: ids.R1 } })).toBe(2);
  });

  it("credits with flags and a device; reads them back into the accrual as Needs-review flags without blocking anything", async () => {
    const { prismaReferralStore: store } = await import("./prisma-store");
    const { attributeSignup } = await import("./attribute");
    const { refreshProgress } = await import("./refresh");
    const at = new Date();
    // A shares the referrer R1's own device; carries a partner-code flag.
    await store.recordDevice(ids.A, D("1"));
    expect(await attributeSignup({ store, userId: "rd-a", referralCode: "DVC32345", outcome: { status: "created", clientId: ids.A }, signedUpAt: at, flags: ["PARTNER_CODE_ALSO_PRESENT"], deviceHash: D("1") })).toEqual({ status: "attributed" });
    // B and C: same device D3, one under R1 (with A), one under R2 (a different referrer).
    await store.recordDevice(ids.B, D("3"));
    await store.recordDevice(ids.C, D("3"));
    await attributeSignup({ store, userId: "rd-b", referralCode: "DVC32345", outcome: { status: "created", clientId: ids.B }, signedUpAt: at, deviceHash: D("3") });
    await attributeSignup({ store, userId: "rd-c", referralCode: "DVC22345", outcome: { status: "created", clientId: ids.C }, signedUpAt: at, deviceHash: D("3") });
    for (const c of ["A", "B", "C"]) await db.kycRecord.create({ data: { clientId: ids[c], status: "APPROVED", completionDate: new Date(Date.now() - 86_400_000) } });
    const out = await refreshProgress({ store, now: new Date() });
    expect(out).toMatchObject({ failed: 0, entriesAccrued: 3 });
    expect((await flagsOf("A"))?.sort()).toEqual(["PARTNER_CODE_ALSO_PRESENT", "SHARES_DEVICE_WITH_REFERRER"]);
    expect(await flagsOf("B")).toEqual(["DEVICE_SHARED_ACROSS_REFERRERS"]);
    expect(await flagsOf("C")).toEqual(["DEVICE_SHARED_ACROSS_REFERRERS"]);
    const referrers = await db.referrer.findMany({ where: { clientId: { in: [ids.R1, ids.R2] } }, select: { id: true } });
    const all = await db.rewardLedgerEntry.findMany({ where: { kind: "ACCRUED", referrerId: { in: referrers.map((r) => r.id) } } });
    expect(all).toHaveLength(3);
    expect(all.every((e) => e.amountPaise === 10000)).toBe(true); // flagged, never trimmed or blocked
  });

  it("only hashes are stored, and a customer's devices go with the customer", async () => {
    const rows = await db.referralDevice.findMany({ where: { clientId: { in: Object.values(ids) } } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.deviceHash))).toBe(true);
    const referral = await db.referral.findFirstOrThrow({ where: { referredClientId: ids.C } });
    await db.rewardLedgerEntry.deleteMany({ where: { referralId: referral.id } });
    await db.referral.delete({ where: { id: referral.id } });
    await db.kycRecord.deleteMany({ where: { clientId: ids.C } });
    await db.client.delete({ where: { id: ids.C } });
    expect(await db.referralDevice.count({ where: { clientId: ids.C } })).toBe(0);
  });
});
