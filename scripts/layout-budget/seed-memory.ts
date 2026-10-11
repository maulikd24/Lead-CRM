/**
 * Synthetic data for the customer memory, complaint, commitment and household screens (layout-budget and screenshots). Local database
 * only. Nothing here is a real person. Idempotent: skipped when the household already exists.
 *
 *   npm run layout-budget:seed      (after `npx tsx prisma/seed.ts` and the busy-customer seed)
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";
import bcrypt from "bcryptjs";

import { prisma } from "../../src/lib/db/prisma";

const DAY = 86_400_000;
const H = 3_600_000;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms);
const ahead = (ms: number) => new Date(now + ms);

async function main() {
  if (await prisma.household.findUnique({ where: { householdCode: "HH-LBM1" } })) {
    console.log("memory seed already present");
    return;
  }
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: "manager@supportify.local" } });
  const rm = await prisma.user.findUniqueOrThrow({ where: { email: "rm@supportify.local" } });
  const rm2 = await prisma.user.upsert({ where: { email: "rm2@supportify.local" }, update: {}, create: { name: "RM Sana", email: "rm2@supportify.local", passwordHash: await bcrypt.hash("password123", 10), role: "RM", managerId: manager.id } });
  // A third relationship manager who reports to nobody here: customers of theirs are outside the manager's scope, so the privacy wall is visible.
  const rm3 = await prisma.user.upsert({ where: { email: "rm3@supportify.local" }, update: {}, create: { name: "RM Tara", email: "rm3@supportify.local", passwordHash: await bcrypt.hash("password123", 10), role: "RM" } });
  const busy = await prisma.client.findUniqueOrThrow({ where: { clientCode: "LB-001" } });
  const stage = await prisma.stage.findFirstOrThrow({ orderBy: { sequence: "desc" } });

  await prisma.consentRecord.create({ data: { clientId: busy.id, purpose: "AI_PROCESSING_OF_CHATS", status: "GRANTED", source: "RM_RECORDED", capturedAt: ago(200 * DAY) } });
  const insight = await prisma.conversationInsight.create({ data: { clientId: busy.id, kind: "INTEREST", text: "Asked about PMS minimums and lock-in", sourceType: "NOTE", sourceRef: "seed", dedupeKey: "lbm-i1", occurredAt: ago(3 * DAY) } });

  type Item = { class: "FACT" | "PREFERENCE" | "INTEREST" | "OBJECTION" | "COMMITMENT" | "GOAL" | "SENTIMENT" | "PRODUCT_STANCE" | "SERVICE_CONTEXT" | "DO_NOT_DO"; key: string; text: string; src: string; state: "CONFIRMED" | "UNCONFIRMED" | "DISPUTED" | "EXPIRED"; conf: "LOW" | "MEDIUM" | "HIGH"; obs: number; /** days of freshness left from now (negative = already out of date); null = no expiry */ fresh: number | null; evidence?: string };
  const items: Item[] = [
    { class: "DO_NOT_DO", key: "do_not_do:calls_before_11", text: "Do not call before 11 in the morning", src: "rm_entry", state: "CONFIRMED", conf: "HIGH", obs: 40, fresh: null },
    { class: "DO_NOT_DO", key: "do_not_do:discuss_bonds", text: "Do not bring up bonds until she raises them", src: "rm_entry", state: "CONFIRMED", conf: "HIGH", obs: 12, fresh: null },
    { class: "FACT", key: "fact:employer", text: "Works at a mid-size logistics firm", src: "rm_entry", state: "CONFIRMED", conf: "HIGH", obs: 120, fresh: 245 },
    { class: "FACT", key: "fact:dependants", text: "Two dependants: a daughter at college and a parent", src: "document", state: "CONFIRMED", conf: "HIGH", obs: 80, fresh: 285 },
    { class: "FACT", key: "fact:external_holding:mf", text: "Holds mutual funds with another broker", src: "conversation_ai", state: "UNCONFIRMED", conf: "MEDIUM", obs: 6, fresh: 359, evidence: "Mentioned funds held elsewhere" },
    { class: "PREFERENCE", key: "preference:language", text: "Prefers Hindi for calls and English for documents", src: "rm_entry", state: "CONFIRMED", conf: "HIGH", obs: 60, fresh: 120 },
    { class: "PREFERENCE", key: "preference:channel", text: "Prefers WhatsApp for updates", src: "conversation_ai", state: "DISPUTED", conf: "MEDIUM", obs: 9, fresh: 171, evidence: "Asked for updates on WhatsApp" },
    { class: "PREFERENCE", key: "preference:channel", text: "Prefers a phone call for updates", src: "rm_entry", state: "DISPUTED", conf: "HIGH", obs: 20, fresh: 160 },
    { class: "INTEREST", key: "interest:PMS", text: "PMS", src: "conversation_ai", state: "UNCONFIRMED", conf: "MEDIUM", obs: 3, fresh: 57, evidence: "Asked about PMS minimums and lock-in" },
    { class: "INTEREST", key: "interest:Tax Planning", text: "Tax Planning", src: "rm_entry", state: "EXPIRED", conf: "HIGH", obs: 130, fresh: -70 },
    { class: "OBJECTION", key: "objection:fees", text: "Thinks the advisory fee is high compared with a direct plan", src: "call_ai", state: "UNCONFIRMED", conf: "LOW", obs: 14, fresh: 46, evidence: "Compared our fee with a direct plan on a call" },
    { class: "PRODUCT_STANCE", key: "product_stance:AIF", text: "AIF: declined", src: "rm_entry", state: "CONFIRMED", conf: "HIGH", obs: 10, fresh: 20 },
    { class: "GOAL", key: "goal:education", text: "Daughter's education in six years", src: "document", state: "CONFIRMED", conf: "HIGH", obs: 90, fresh: null },
    { class: "SENTIMENT", key: "sentiment:recent", text: "Recent tone: frustrated about the delayed statement", src: "call_ai", state: "UNCONFIRMED", conf: "LOW", obs: 4, fresh: 26, evidence: "Sounded frustrated about the statement" },
    { class: "SERVICE_CONTEXT", key: "service_context:open_ticket", text: "One support ticket open about a statement", src: "system", state: "CONFIRMED", conf: "HIGH", obs: 2, fresh: 14 },
  ];
  for (const i of items) {
    await prisma.customerMemoryItem.create({
      data: {
        clientId: busy.id, class: i.class, key: i.key, value: { text: i.text }, sourceType: i.src, sourceRef: i.src.endsWith("_ai") ? `insight:${insight.id}` : `user:${rm.id}`,
        evidence: i.evidence ? [{ sourceRef: `insight:${insight.id}`, summary: i.evidence, observedAt: ago(i.obs * DAY).toISOString() }] : [{ sourceRef: `user:${rm.id}`, summary: "Entered by the RM", observedAt: ago(i.obs * DAY).toISOString() }],
        confidence: i.conf, observedAt: ago(i.obs * DAY), freshUntil: i.fresh === null ? null : ahead(i.fresh * DAY), confirmation: i.state, lastReconfirmedAt: i.state === "CONFIRMED" ? ago(i.obs * DAY) : null,
        confirmedById: i.state === "CONFIRMED" ? rm.id : null, confirmedAt: i.state === "CONFIRMED" ? ago(i.obs * DAY) : null, disputedReason: i.state === "DISPUTED" ? "Conflicts with another item for the same thing" : null,
        dataClass: i.class === "GOAL" || i.class === "FACT" || i.class === "SENTIMENT" ? "SENSITIVE_PERSONAL" : "PERSONAL", consentBasis: i.src === "conversation_ai" ? "AI_PROCESSING_OF_CHATS" : null,
        createdByType: i.src.endsWith("_ai") ? "AI_AGENT" : "RM", createdById: i.src.endsWith("_ai") ? "memory_extractor" : rm.id,
      },
    });
  }

  // Complaints: one breached, one in progress, one resolved recently; commitments: overdue, due soon, suggested.
  const ticket = await prisma.supportTicket.findFirst({ where: { clientId: busy.id } });
  const mk = (title: string, severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", status: "OPEN" | "IN_PROGRESS" | "RESOLVED", openedH: number, slaH: number, extra: object = {}) =>
    prisma.complaint.create({ data: { clientId: busy.id, title, severity, status, sourceType: "MANUAL", ownerId: rm.id, openedAt: ago(openedH * H), slaDueAt: ago(openedH * H - slaH * H), ...extra } });
  await mk("Withdrawal credited three days late", "HIGH", "OPEN", 90, 48);
  await mk("Contract note shows the wrong brokerage", "MEDIUM", "IN_PROGRESS", 30, 72, { acknowledgedAt: ago(28 * H) });
  await mk("Statement email never arrived", "LOW", "RESOLVED", 200, 120, { acknowledgedAt: ago(190 * H), resolvedAt: ago(100 * H), resolutionCode: "FIXED", resolution: "Resent and fixed the address" });
  if (ticket) await prisma.complaint.updateMany({ where: { clientId: busy.id, title: { startsWith: "Contract" } }, data: { supportTicketId: ticket.id, sourceType: "TICKET" } });
  await prisma.commitment.create({ data: { clientId: busy.id, promisedByType: "RM", promisedById: rm.id, text: "Send the capital gains statement", dueAt: ago(2 * DAY), ownerId: rm.id, sourceType: "MANUAL", confirmedById: rm.id, confirmedAt: ago(9 * DAY) } });
  await prisma.commitment.create({ data: { clientId: busy.id, promisedByType: "RM", promisedById: rm.id, text: "Call back with PMS lock-in details", dueAt: ahead(10 * H), ownerId: rm.id, sourceType: "MANUAL", confirmedById: rm.id, confirmedAt: ago(1 * DAY) } });
  await prisma.commitment.create({ data: { clientId: busy.id, promisedByType: "RM", promisedById: rm.id, text: "Share the fee comparison sheet", dueAt: ahead(3 * DAY), ownerId: rm.id, sourceType: "INSIGHT", insightId: insight.id, dedupeKey: `insight:${insight.id}` } });

  // Household: the busy customer, a second member of the same RM, and a third who is another RM's customer.
  const m2 = await prisma.client.create({ data: { clientCode: "LBM-002", name: "Household Member Two", currentStageId: stage.id, assignedToId: rm.id, status: "ACTIVE" } });
  const m3 = await prisma.client.create({ data: { clientCode: "LBM-003", name: "Household Member Three", currentStageId: stage.id, assignedToId: rm3.id, status: "ACTIVE" } });
  const m4 = await prisma.client.create({ data: { clientCode: "LBM-004", name: "Household Member Four", currentStageId: stage.id, assignedToId: rm3.id, status: "ACTIVE" } });
  const hh = await prisma.household.create({ data: { householdCode: "HH-LBM1", name: "Layout Memory household", members: { create: [{ clientId: busy.id, relationship: "Self", isPrimary: true }, { clientId: m2.id, relationship: "Spouse" }, { clientId: m3.id, relationship: "Parent" }, { clientId: m4.id, relationship: "Child" }] } } });
  for (const [c, label] of [[m3, "m3"], [m4, "m4"]] as const) {
    const acct = await prisma.tradingAccount.create({ data: { accountNumber: `LBM-ACC-${label}`, clientId: c.id, accountType: "EQUITY" } });
    const prod = await prisma.product.upsert({ where: { productCode: "LBM-P1" }, update: {}, create: { productCode: "LBM-P1", name: "Layout memory fund", category: "MUTUAL_FUND" } });
    await prisma.position.create({ data: { tradingAccountId: acct.id, productId: prod.id, quantity: 10, currentValue: label === "m3" ? 4_200_000 : 900_000, asOfDate: ago(DAY), sourceSystem: "seed", externalRef: `lbm-${label}` } });
  }
  await prisma.householdRelationshipConsent.create({ data: { householdId: hh.id, subjectClientId: m3.id, granteeClientId: null, scopes: ["member_identity", "portfolio_summary"], status: "GRANTED", source: "RM_RECORDED", capturedAt: ago(5 * DAY) } });
  console.log("memory seed done");
}

main().finally(() => prisma.$disconnect());
