/**
 * Synthetic data for the customer outcomes screens (goals, reviews, suggestions, a queue of customers needing attention) for the
 * layout-budget test. Local database only. Nothing here is a real person. Idempotent: customers whose code already exists are skipped.
 *
 *   npm run layout-budget:seed      (after `npx tsx prisma/seed.ts`)
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";
import bcrypt from "bcryptjs";

import { prisma } from "../../src/lib/db/prisma";

const DAY = 86_400_000;
const now = Date.now();
const ago = (d: number) => new Date(now - d * DAY);

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: "manager@supportify.local" } });
  const rm = await prisma.user.findUniqueOrThrow({ where: { email: "rm@supportify.local" } });
  const rm2 = await prisma.user.upsert({ where: { email: "rm2@supportify.local" }, update: {}, create: { name: "RM Sana", email: "rm2@supportify.local", passwordHash, role: "RM", managerId: manager.id } });
  await prisma.user.update({ where: { id: rm.id }, data: { managerId: manager.id } });
  const stage = await prisma.stage.findFirstOrThrow({ orderBy: { sequence: "desc" } });

  const products = [
    { productCode: "OUT-MF-1", name: "Balanced Advantage Fund", category: "MUTUAL_FUND" },
    { productCode: "OUT-MF-2", name: "Flexi Cap Fund", category: "MUTUAL_FUND" },
    { productCode: "OUT-EQ-1", name: "Blue Chip Equity Basket", category: "EQUITY" },
    { productCode: "OUT-BD-1", name: "Corporate Bond Series", category: "BOND" },
    { productCode: "OUT-FD-1", name: "Fixed Deposit", category: "FIXED_DEPOSIT" },
  ] as const;
  const prod: Record<string, string> = {};
  for (const p of products) prod[p.productCode] = (await prisma.product.upsert({ where: { productCode: p.productCode }, update: {}, create: { ...p } })).id;

  type Spec = {
    code: string; name: string; rmId: string; createdDaysAgo: number; kyc: "APPROVED" | "PENDING" | "REJECTED";
    holdings: { p: string; value: number; refValue?: number }[]; lastContactDays: number | null; lastTxDays: number | null; reviewDaysAgo: number | null;
    consent: "given" | "withdrawn" | "none"; tickets?: number; idleCash?: number; goals?: { name: string; target: number; years: number; priority: "HIGH" | "MEDIUM" | "LOW"; rate?: number; monthly?: number; link: string[] }[];
    promise?: { text: string; dueDays: number };
  };
  const specs: Spec[] = [
    { code: "OUT-001", name: "Aarav Mehta", rmId: rm.id, createdDaysAgo: 1100, kyc: "APPROVED", holdings: [{ p: "OUT-MF-1", value: 6_500_000, refValue: 6_300_000 }, { p: "OUT-EQ-1", value: 7_500_000, refValue: 7_200_000 }, { p: "OUT-BD-1", value: 4_000_000, refValue: 4_000_000 }], lastContactDays: 20, lastTxDays: 25, reviewDaysAgo: 130, consent: "given", idleCash: 1_500_000,
      goals: [{ name: "Retirement corpus", target: 60_000_000, years: 12, priority: "HIGH", rate: 9, monthly: 50_000, link: ["OUT-MF-1", "OUT-EQ-1"] }, { name: "Daughter's education", target: 12_000_000, years: 6, priority: "MEDIUM", rate: 8, monthly: 70_000, link: ["OUT-BD-1"] }], promise: { text: "Send the capital gains statement", dueDays: -2 } },
    { code: "OUT-002", name: "Diya Nair", rmId: rm.id, createdDaysAgo: 320, kyc: "APPROVED", holdings: [{ p: "OUT-EQ-1", value: 3_600_000, refValue: 3_700_000 }, { p: "OUT-MF-2", value: 400_000, refValue: 400_000 }], lastContactDays: 45, lastTxDays: 60, reviewDaysAgo: null, consent: "withdrawn", tickets: 1,
      goals: [{ name: "Home down payment", target: 5_000_000, years: 2, priority: "HIGH", rate: 8, monthly: 120_000, link: ["OUT-EQ-1", "OUT-MF-2"] }] },
    { code: "OUT-003", name: "Kabir Shah", rmId: rm.id, createdDaysAgo: 700, kyc: "PENDING", holdings: [{ p: "OUT-MF-2", value: 600_000, refValue: 800_000 }], lastContactDays: 150, lastTxDays: 300, reviewDaysAgo: 400, consent: "given", tickets: 2,
      goals: [{ name: "Emergency fund", target: 1_000_000, years: 1, priority: "HIGH", monthly: 5_000, link: ["OUT-MF-2"] }] },
    { code: "OUT-004", name: "Meera Iyer", rmId: rm.id, createdDaysAgo: 500, kyc: "APPROVED", holdings: [{ p: "OUT-MF-1", value: 1_200_000, refValue: 1_150_000 }, { p: "OUT-BD-1", value: 900_000, refValue: 900_000 }, { p: "OUT-EQ-1", value: 700_000, refValue: 650_000 }], lastContactDays: 12, lastTxDays: 15, reviewDaysAgo: 20, consent: "given",
      goals: [{ name: "Travel fund", target: 1_500_000, years: 3, priority: "LOW", rate: 7, monthly: 25_000, link: ["OUT-BD-1"] }] },
    { code: "OUT-005", name: "Rohan Das", rmId: rm2.id, createdDaysAgo: 600, kyc: "APPROVED", holdings: [{ p: "OUT-EQ-1", value: 9_500_000, refValue: 10_000_000 }, { p: "OUT-MF-1", value: 500_000, refValue: 500_000 }], lastContactDays: 95, lastTxDays: 80, reviewDaysAgo: 150, consent: "given", idleCash: 2_000_000,
      goals: [{ name: "Business expansion", target: 20_000_000, years: 5, priority: "HIGH", rate: 10, monthly: 100_000, link: ["OUT-EQ-1"] }] },
    { code: "OUT-006", name: "Ishita Rao", rmId: rm2.id, createdDaysAgo: 250, kyc: "APPROVED", holdings: [{ p: "OUT-MF-2", value: 2_800_000, refValue: 2_700_000 }, { p: "OUT-FD-1", value: 1_200_000, refValue: 1_200_000 }], lastContactDays: 40, lastTxDays: 70, reviewDaysAgo: 60, consent: "given",
      goals: [{ name: "Child's higher studies", target: 8_000_000, years: 9, priority: "MEDIUM", rate: 9, monthly: 20_000, link: ["OUT-MF-2"] }] },
  ];

  for (const s of specs) {
    if (await prisma.client.findUnique({ where: { clientCode: s.code } })) continue;
    const client = await prisma.client.create({
      data: { clientCode: s.code, name: s.name, mobile: null, currentStageId: stage.id, status: "ACTIVE", assignedToId: s.rmId, createdAt: ago(s.createdDaysAgo), customerCategory: "Wealth" },
    });
    await prisma.kycRecord.create({ data: { clientId: client.id, status: s.kyc } });
    const account = await prisma.tradingAccount.create({ data: { accountNumber: `OUT-ACC-${s.code.slice(-3)}-1234`, clientId: client.id, accountType: "MUTUAL_FUND", sourceSystem: "seed", externalRef: `acct-${s.code}` } });
    for (const h of s.holdings) {
      const productId = prod[h.p];
      await prisma.position.create({ data: { tradingAccountId: account.id, productId, quantity: 100, currentValue: h.value, asOfDate: ago(1), sourceSystem: "seed", externalRef: `${s.code}-${h.p}` } });
      if (h.refValue !== undefined) await prisma.position.create({ data: { tradingAccountId: account.id, productId, quantity: 100, currentValue: h.refValue, asOfDate: ago(85), sourceSystem: "seed", externalRef: `${s.code}-${h.p}` } });
    }
    if (s.lastTxDays !== null) await prisma.transaction.create({ data: { tradingAccountId: account.id, productId: prod[s.holdings[0].p], transactionType: "BUY", transactionDate: ago(s.lastTxDays), grossAmount: 50_000, sourceSystem: "seed", externalRef: `tx-${s.code}` } });
    if (s.lastContactDays !== null) await prisma.activity.create({ data: { clientId: client.id, type: "CALL", payload: { note: "Seeded call" }, createdAt: ago(s.lastContactDays) } });
    if (s.reviewDaysAgo !== null) await prisma.customerReview.create({ data: { clientId: client.id, reviewedAt: ago(s.reviewDaysAgo), reviewedById: s.rmId } });
    if (s.consent !== "none") {
      await prisma.consentRecord.create({ data: { clientId: client.id, purpose: "MARKETING_COMMS", status: "GRANTED", source: "app", capturedAt: ago(s.createdDaysAgo - 5) } });
      if (s.consent === "withdrawn") await prisma.consentRecord.create({ data: { clientId: client.id, purpose: "MARKETING_COMMS", status: "WITHDRAWN", source: "app", capturedAt: ago(30) } });
    }
    for (let i = 0; i < (s.tickets ?? 0); i++) await prisma.supportTicket.create({ data: { clientId: client.id, provider: "seed", externalId: `${s.code}-t${i}`, subject: "Statement query", status: "open", ticketCreatedAt: ago(5 + i) } });
    if (s.idleCash) await prisma.customerIntelligence.create({ data: { clientId: client.id, lifecycleStage: "Active", idleCashEstimate: s.idleCash, estimatesSource: "rm", estimatesUpdatedAt: ago(10), nbaProgramme: "No Action", nbaAction: "No Action", nbaReason: "Seeded", nbaPriority: "Low", nbaOwner: "RM", nbaTiming: "Later", talkingPoints: [], situations: [], doNotDiscuss: [] } });
    if (s.promise) await prisma.conversationInsight.create({ data: { clientId: client.id, kind: "COMMITMENT", text: s.promise.text, dueAt: ago(-s.promise.dueDays), sourceType: "NOTE", sourceRef: "seed", dedupeKey: `seed-${s.code}-promise`, occurredAt: ago(10) } });
    for (const g of s.goals ?? []) {
      const ids = g.link.map((p) => prod[p]);
      await prisma.customerGoal.create({ data: { clientId: client.id, name: g.name, targetAmount: g.target, targetDate: new Date(now + g.years * 365 * DAY), priority: g.priority, assumedAnnualRatePct: g.rate ?? null, plannedMonthly: g.monthly ?? null, linkedHoldingKeys: ids.map((id) => `${account.id}:${id}`), createdById: s.rmId } });
    }
  }
  console.log("seeded outcomes customers");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
