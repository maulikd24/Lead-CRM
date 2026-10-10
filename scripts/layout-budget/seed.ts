/**
 * Synthetic data for the layout-budget test (scripts/layout-budget/run.mjs). It builds one deliberately BUSY customer
 * (long timeline, many tasks, holdings, transactions, tickets, calls, goals, consent rows) plus a queue of possible
 * duplicates, so every list on every converted screen is longer than a phone should ever show at once.
 *
 * Local database only (the import below refuses anything else). Nothing here is a real person. Idempotent.
 *
 *   npm run layout-budget:seed
 *
 * Needs the standard seed first (`npx tsx prisma/seed.ts`) for the users and stages.
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";

import { prisma } from "../../src/lib/db/prisma";

const DAY = 86_400_000;
const H = 3_600_000;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);
const ahead = (ms: number) => new Date(now + ms);

export const BUSY_CODE = "LB-001";

async function main() {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@supportify.local" } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: "manager@supportify.local" } });
  const rm = await prisma.user.findUniqueOrThrow({ where: { email: "rm@supportify.local" } });
  await prisma.user.update({ where: { id: rm.id }, data: { managerId: manager.id } });
  const stages = await prisma.stage.findMany({ orderBy: { sequence: "asc" } });
  const stage = stages[Math.min(2, stages.length - 1)];

  const existing = await prisma.client.findUnique({ where: { clientCode: BUSY_CODE } });
  if (existing) {
    await addGoals(existing.id, rm.id);
    console.log("layout-budget seed already present");
    return;
  }

  const c = await prisma.client.create({
    data: { clientCode: BUSY_CODE, name: "Layout Budget Customer", mobile: "+919000011111", email: "layout.budget@example.test", city: "Mumbai", preferredLanguage: "English", investmentCategory: "Wealth & Broking", customerCategory: "Wealth", leadSource: "Referral", priority: "HIGH", currentStageId: stage.id, assignedToId: rm.id, status: "ACTIVE", expectedInvestment: 25_000_000, createdAt: ago(900 * DAY), stageEnteredAt: ago(9 * DAY) },
  });
  await prisma.kycRecord.create({ data: { clientId: c.id, status: "APPROVED" } });

  // Timeline: 48 events of mixed kinds.
  const kinds = ["NOTE", "CALL", "MESSAGE", "MEETING", "CONTACT", "STAGE_CHANGE", "TICKET", "STATUS_CHANGE"] as const;
  for (let i = 0; i < 48; i++) {
    const type = kinds[i % kinds.length];
    const payload =
      type === "MESSAGE" ? { channel: "whatsapp", direction: i % 2 ? "INBOUND" : "OUTBOUND", body: `Synthetic message ${i} about the quarterly review and the next steps we agreed.` }
      : type === "CALL" ? { status: "completed", durationSeconds: 60 + i * 11, message: `Synthetic call ${i}` }
      : type === "STAGE_CHANGE" ? { fromStage: "Lead", toStage: "Onboarding" }
      : type === "TICKET" ? { ticketId: String(7000 + i), subject: `Statement query ${i}`, status: "open" }
      : type === "STATUS_CHANGE" ? { status: "ACTIVE" }
      : { message: `Synthetic note ${i}: the customer asked about allocation, fees and the timing of the next review.` };
    await prisma.activity.create({ data: { clientId: c.id, userId: rm.id, type, payload, createdAt: ago((i * 17 + 3) * H) } });
  }

  // Tasks: 14, mixed status and category.
  const cats = ["FOLLOW_UP", "MEETING", "FUNDING", "OTHER"] as const;
  for (let i = 0; i < 14; i++) await prisma.task.create({ data: { clientId: c.id, assignedToId: rm.id, title: `Synthetic task ${i + 1}: confirm details and follow up`, dueAt: i % 3 === 0 ? ago((i + 1) * DAY) : ahead((i + 1) * DAY), status: i % 5 === 4 ? "DONE" : "PENDING", category: cats[i % 4], source: "manual" } });

  // Holdings: one account, 10 products, two snapshots; 24 transactions.
  const account = await prisma.tradingAccount.create({ data: { accountNumber: "LB-ACC-0001", clientId: c.id, accountType: "MUTUAL_FUND", sourceSystem: "seed", externalRef: "lb-acct-1" } });
  const cat = ["MUTUAL_FUND", "EQUITY", "BOND", "FIXED_DEPOSIT"] as const;
  for (let i = 0; i < 10; i++) {
    const p = await prisma.product.upsert({ where: { productCode: `LB-P-${i}` }, update: {}, create: { productCode: `LB-P-${i}`, name: `Synthetic Product ${i + 1}`, category: cat[i % 4] } });
    await prisma.position.create({ data: { tradingAccountId: account.id, productId: p.id, quantity: 100 + i, currentValue: 400_000 + i * 90_000, asOfDate: ago(DAY), sourceSystem: "seed", externalRef: `lb-${i}` } });
    await prisma.position.create({ data: { tradingAccountId: account.id, productId: p.id, quantity: 100 + i, currentValue: 380_000 + i * 85_000, asOfDate: ago(85 * DAY), sourceSystem: "seed", externalRef: `lb-${i}` } });
    for (let t = 0; t < 2; t++) await prisma.transaction.create({ data: { tradingAccountId: account.id, productId: p.id, transactionType: t ? "SIP" : "BUY", transactionDate: ago((i * 9 + t * 40 + 2) * DAY), grossAmount: 25_000 + i * 1000, sourceSystem: "seed", externalRef: `lb-tx-${i}-${t}` } });
  }

  // Consent: six purposes. Tickets: 9. Opportunities: 6. Wealth check-up.
  const purposes = ["MARKETING_COMMS", "SERVICE_COMMS", "AI_PROCESSING_OF_CHATS", "CALL_RECORDING", "DATA_SHARING_PARTNERS", "DO_NOT_CONTACT"];
  for (let i = 0; i < purposes.length; i++) await prisma.consentRecord.create({ data: { clientId: c.id, purpose: purposes[i], status: i === 4 ? "WITHDRAWN" : "GRANTED", source: "RM_RECORDED", capturedAt: ago((i + 3) * DAY) } });
  for (let i = 0; i < 9; i++) await prisma.supportTicket.create({ data: { clientId: c.id, provider: "seed", externalId: `LB-T${i}`, subject: `Synthetic ticket ${i + 1}`, status: i % 3 ? "open" : "resolved", priority: "medium", channel: "email", ticketCreatedAt: ago((i + 1) * 2 * DAY) } });
  const products = ["MUTUAL_FUND", "BROKING", "PMS", "AIF", "BONDS", "FIXED_INCOME"] as const;
  for (let i = 0; i < 6; i++) await prisma.opportunity.create({ data: { clientId: c.id, product: products[i], estimatedValue: 500_000 + i * 250_000, estimatedAum: 2_000_000, stage: i % 2 ? "DISCUSSED" : "INTERESTED", ownerId: rm.id } });
  await prisma.wealthHealthCheckup.create({ data: { clientId: c.id, status: "COMPLETED", completedAt: ago(30 * DAY), keyFindings: "Synthetic findings: allocation is concentrated; cash is idle; one goal is behind.", performedById: manager.id } });
  for (let i = 0; i < 8; i++) await prisma.document.create({ data: { clientId: c.id, documentType: `Synthetic document ${i + 1}`, mandatory: i < 5, status: i % 4 === 3 ? "PENDING" : "VERIFIED", receivedAt: ago(20 * DAY) } });

  // Calls with reviews (the call list and the client's call rows).
  const sentiments = ["positive", "neutral", "mixed", "negative"];
  for (let i = 0; i < 14; i++) {
    const a = await prisma.activity.create({ data: { clientId: c.id, userId: rm.id, type: "CALL", createdAt: ago((i * 11 + 5) * H), payload: { direction: i % 2 ? "inbound" : "outbound", status: "completed", durationSeconds: 120 + i * 20 } } });
    await prisma.conversationReview.create({ data: { clientId: c.id, sourceType: "CALL", sourceActivityId: a.id, assignedRmId: rm.id, status: "ANALYZED", sentimentLabel: sentiments[i % 4], sentimentScore: 0.2, sentimentReasoning: "Synthetic reasoning.", qualityScore: 40 + ((i * 13) % 55), transcript: `[0:02] RM: Good morning, this is a synthetic call ${i}.\n[0:10] Customer: Hello, I wanted to ask about charges.`, analyzedAt: ago(i * H) } });
  }

  // A queue of possible duplicates for the review screen.
  const others = [];
  for (let i = 0; i < 8; i++) others.push(await prisma.client.create({ data: { clientCode: `LB-D${i}`, name: `Layout Budget Duplicate ${i}`, mobile: `+91900002${String(i).padStart(4, "0")}`, email: `lb.dup${i}@example.test`, currentStageId: stage.id, assignedToId: i % 2 ? manager.id : rm.id } }));
  for (let i = 0; i < 8; i++) await prisma.mergeSuggestion.create({ data: { clientAId: c.id, clientBId: others[i].id, score: 0.95 - i * 0.04, reasons: ["Similar name", "Same city"] } });

  // A few agent drafts so the review queue is longer than one screen.
  for (let i = 0; i < 6; i++) await prisma.agentProposal.create({ data: { agentKey: "wa_nudger", clientId: c.id, status: "DRAFT", body: `Synthetic draft ${i + 1}: a short, polite check-in about your review.`, originalBody: `Synthetic draft ${i + 1}: a short, polite check-in about your review.`, reason: "Synthetic.", provider: "mock", model: "mock", expiresAt: ahead(3 * DAY) } });

  await addGoals(c.id, rm.id);
  void admin;
  console.log("layout-budget seed ok");
}

/** Goals for the outcomes screens (linked to the seeded holdings). Skipped when the customer already has goals. */
async function addGoals(clientId: string, rmId: string) {
  if ((await prisma.customerGoal.count({ where: { clientId } })) > 0) return;
  const account = await prisma.tradingAccount.findFirstOrThrow({ where: { clientId } });
  const products = await prisma.product.findMany({ where: { productCode: { startsWith: "LB-P-" } }, orderBy: { productCode: "asc" } });
  const key = (i: number) => `${account.id}:${products[i].id}`;
  const goals = [
    { name: "Retirement corpus", target: 60_000_000, years: 14, priority: "HIGH", rate: 9, monthly: 50_000, link: [0, 1, 2, 3] },
    { name: "Education fund", target: 12_000_000, years: 6, priority: "MEDIUM", rate: 8, monthly: 70_000, link: [4, 5] },
    { name: "Home down payment", target: 8_000_000, years: 3, priority: "HIGH", rate: 7, monthly: 90_000, link: [6] },
    { name: "Travel fund", target: 1_500_000, years: 2, priority: "LOW", rate: null, monthly: null, link: [7] },
  ] as const;
  for (const g of goals) await prisma.customerGoal.create({ data: { clientId, name: g.name, targetAmount: g.target, targetDate: new Date(now + g.years * 365 * DAY), priority: g.priority, assumedAnnualRatePct: g.rate, plannedMonthly: g.monthly, linkedHoldingKeys: g.link.map(key), createdById: rmId } });
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
