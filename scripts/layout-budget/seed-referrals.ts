/**
 * Synthetic referral-programme data for the layout-budget test (scripts/layout-budget/run.mjs): referrers with codes, reward
 * rules, signups at every step, rewards in every state, clawbacks and statements. Local database only. Nothing here is a real person.
 * Idempotent: it does nothing when the first referrer already exists.
 *
 *   npm run layout-budget:seed      (after `npx tsx prisma/seed.ts`)
 */
import "dotenv/config";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error("Refusing a non-local database");

async function main() {
  const { basePrisma: db } = await import("../../src/lib/db/prisma");
  const { attributeSignup } = await import("../../src/lib/referrals/attribute");
  const { prismaReferralStore: store } = await import("../../src/lib/referrals/prisma-store");
  const { refreshProgress } = await import("../../src/lib/referrals/refresh");
  const { prepareStatement, approveStatement, markStatementPaid } = await import("../../src/lib/referrals/statements");
  const { monthKeyIST } = await import("../../src/lib/referrals/rewards");
  const { DEFAULT_DISCLAIMER, wordingHash } = await import("../../src/lib/referrals/disclosure");

  if (await db.referralCode.findUnique({ where: { code: "QK4M7R2T" } })) {
    console.log("referral seed already present");
    return;
  }
  const now = new Date();
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const stage = await db.stage.findFirstOrThrow();
  const admin = await db.user.findFirstOrThrow({ where: { email: "admin@supportify.local" }, omit: { passwordHash: false } });
  const finance = await db.user.upsert({ where: { email: "finance@supportify.local" }, update: { role: "FINANCE" }, create: { name: "Finance Tester", email: "finance@supportify.local", passwordHash: admin.passwordHash, role: "FINANCE" } });

  await db.referralSetting.upsert({ where: { key: "disclaimer_signoff" }, update: {}, create: { key: "disclaimer_signoff", value: JSON.stringify({ by: finance.id, approver: "A. Reviewer (compliance)", at: now.toISOString(), hash: wordingHash(DEFAULT_DISCLAIMER) }) } });
  await db.rewardRule.create({ data: { name: "KYC complete bonus", event: "KYC_COMPLETE", kind: "FIXED", fixedPaise: 10000, capPerReferrerMonthPaise: 50000, clawbackDays: 30, active: true, validFrom: day(120), createdById: admin.id } });
  await db.rewardRule.create({ data: { name: "First funding share", event: "FIRST_FUNDING", kind: "PERCENT", percentBps: 100, maxRewardPaise: 250000, clawbackDays: 60, active: true, validFrom: day(120), createdById: admin.id } });
  await db.rewardRule.create({ data: { name: "Sign-up welcome (not yet decided)", event: "SIGNED_UP", kind: "FIXED", fixedPaise: 2500, active: false, createdById: admin.id } });

  const NAMES = ["Aarav Mehta", "Diya Nair", "Kabir Sethi", "Ishita Rao", "Vihaan Shah", "Meera Iyer", "Arjun Pillai", "Tara Banerjee", "Nisha Verma", "Rehan Qureshi", "Sunita Kulkarni"];
  const CODES = ["QK4M7R2T", "HX9PBD3W", "C6NZ2VJ8", "MT8F5KQ4", "R3YG7XAD", "W9BE4HN6", "D2JS8CP5", "V7KT3ZM9", "F5NH8KR2", "G4XC6WE7", "J8PM3DS5"];
  const REFERRED = ["Rohan", "Sana", "Kunal", "Naina", "Dev", "Pooja", "Yash", "Anika", "Rahul", "Zoya", "Neel", "Isha", "Karan", "Mira", "Om", "Riya", "Sahil", "Tanvi", "Uday", "Veda", "Wasim", "Xena", "Yuvraj", "Zara"];
  let phone = 9_700_000_000;
  const mk = async (code: string, name: string, extra: Record<string, unknown> = {}) => db.client.create({ data: { clientCode: code, name, mobile: String(++phone), currentStageId: stage.id, ...extra } });

  const referrers: { id: string; code: string; clientId: string }[] = [];
  for (let i = 0; i < NAMES.length; i++) {
    const c = await mk(`RFD-${100 + i}`, NAMES[i]);
    const r = await db.referrer.create({ data: { clientId: c.id, createdById: admin.id, status: i === 7 ? "SUSPENDED" : "ACTIVE", codes: { create: { code: CODES[i], createdAt: day(100) } } } });
    referrers.push({ id: r.id, code: CODES[i], clientId: c.id });
  }
  await db.referralCode.create({ data: { referrerId: referrers[2].id, code: "PLDP2PL3".replace(/L/g, "K"), status: "REVOKED", createdAt: day(110), revokedAt: day(60), revokeReason: "Shared on a public forum" } });

  let n = 0;
  const hash = (c: string) => c.repeat(64).slice(0, 64);
  const refer = async (r: (typeof referrers)[number], ageDays: number, opts: { kyc?: number; fund?: number; amount?: string; phoneOf?: string; device?: string; flags?: string[] } = {}) => {
    const name = `${REFERRED[n % REFERRED.length]} ${["Kapoor", "Joshi", "Menon", "Gill", "Das"][n % 5]}`;
    const c = await mk(`RFD-${300 + n}`, name, opts.phoneOf ? { mobile: opts.phoneOf } : {});
    if (opts.device) await store.recordDevice(c.id, hash(opts.device));
    await attributeSignup({ store, userId: `seed-user-${n}`, referralCode: r.code, outcome: { status: "created", clientId: c.id }, signedUpAt: day(ageDays), flags: opts.flags, deviceHash: opts.device ? hash(opts.device) : undefined });
    if (opts.kyc !== undefined) await db.kycRecord.create({ data: { clientId: c.id, status: "APPROVED", completionDate: day(opts.kyc) } });
    if (opts.fund !== undefined) await db.fundingRecord.create({ data: { clientId: c.id, status: "FULLY_FUNDED", amount: opts.amount ?? "100000", fundingDate: day(opts.fund) } });
    n++;
    return c;
  };

  await refer(referrers[0], 50, { kyc: 45, fund: 40, amount: "250000" });
  await refer(referrers[0], 38, { kyc: 33, fund: 31, amount: "100000" });
  await refer(referrers[0], 20, { kyc: 16, fund: 12, amount: "500000" });
  await refer(referrers[0], 6, { kyc: 3 });
  await refer(referrers[0], 2);
  await refer(referrers[1], 44, { kyc: 40, fund: 36, amount: "1000000" });
  await refer(referrers[1], 29, { kyc: 24 });
  await refer(referrers[1], 11, { kyc: 8, fund: 5, amount: "75000" });
  await refer(referrers[1], 4);
  await refer(referrers[2], 35, { kyc: 30, fund: 26, amount: "300000" });
  await refer(referrers[2], 15);
  await refer(referrers[3], 52, { kyc: 48 });
  await refer(referrers[3], 27, { kyc: 22, fund: 18, amount: "125000" });
  await refer(referrers[4], 9, { kyc: 6 });
  await refer(referrers[4], 3);
  await refer(referrers[5], 1);
  for (let i = 0; i < 7; i++) await refer(referrers[6], 5 + (i % 2), { kyc: 3 - (i % 2) });
  const shared = "9811122233";
  await refer(referrers[3], 8, { kyc: 4, phoneOf: shared });
  await refer(referrers[3], 8, { kyc: 4, phoneOf: shared });
  // Device signals: the same device under two referrers, a referral on the referrer's own device, and a partner code that came too.
  await store.recordDevice(referrers[8].clientId, hash("a"));
  await refer(referrers[8], 7, { kyc: 5, device: "a" });
  await refer(referrers[9], 6, { kyc: 4, device: "b" });
  await refer(referrers[10], 6, { kyc: 4, device: "b" });
  await refer(referrers[9], 5, { kyc: 3, flags: ["PARTNER_CODE_ALSO_PRESENT"] });

  const stranger = await mk("RFD-900", "Existing Customer");
  await attributeSignup({ store, userId: "seed-rej-1", referralCode: "ZZZZ2222", outcome: { status: "created", clientId: stranger.id }, signedUpAt: day(2) });
  await attributeSignup({ store, userId: "seed-rej-2", referralCode: referrers[1].code, outcome: { status: "duplicate", clientId: referrers[1].clientId }, signedUpAt: day(2) });
  await attributeSignup({ store, userId: "seed-rej-3", referralCode: referrers[0].code, outcome: { status: "duplicate", clientId: stranger.id }, signedUpAt: day(1) });
  await attributeSignup({ store, userId: "seed-rej-4", referralCode: referrers[0].code, outcome: { status: "created", clientId: stranger.id }, signedUpAt: day(0.5) });
  console.log("refresh 1", await refreshProgress({ store, now }));

  // Statements for the current month (one prepared, one approved and paid, one approved).
  const period = monthKeyIST(now);
  const A = { id: admin.id, role: "ADMIN" as const };
  const F = { id: finance.id, role: "FINANCE" as const };
  const p0 = await prepareStatement({ store, actor: A, referrerId: referrers[0].id, period });
  const p1 = await prepareStatement({ store, actor: A, referrerId: referrers[1].id, period });
  const p2 = await prepareStatement({ store, actor: F, referrerId: referrers[2].id, period });
  console.log({ p0: p0.ok, p1: p1.ok, p2: p2.ok });
  if (p1.ok) {
    await approveStatement({ store, actor: F, statementId: p1.statementId });
    await markStatementPaid({ store, actor: F, statementId: p1.statementId, bankReference: "UTR26100912345678" });
  }
  if (p2.ok) await approveStatement({ store, actor: A, statementId: p2.statementId });

  // Clawbacks: a KYC revoked inside the window for a reward that was ALREADY PAID (recovery on a later statement), one for a
  // reward not yet on a statement (simply cancelled), and a funding reversal.
  const kycOf = async (clientCode: string) => (await db.client.findFirstOrThrow({ where: { clientCode } })).id;
  const paidKyc = await kycOf("RFD-307"); // referrers[1] third referral: KYC 8 days ago, on the paid statement
  await db.kycRecord.update({ where: { clientId: paidKyc }, data: { status: "REJECTED", rejectionReason: "Document mismatch (synthetic)" } });
  const freshKyc = await kycOf("RFD-303"); // referrers[0]: KYC 3 days ago, statement only prepared
  await db.kycRecord.update({ where: { clientId: freshKyc }, data: { status: "PENDING" } });
  const funded = await kycOf("RFD-309"); // referrers[2] first: funding 26 days ago
  await db.fundingRecord.update({ where: { clientId: funded }, data: { status: "NOT_PROCEEDING" } });
  console.log("refresh 2", await refreshProgress({ store, now: new Date() }));
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
