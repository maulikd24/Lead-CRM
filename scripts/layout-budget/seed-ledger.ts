/**
 * Synthetic Action Ledger data for the busy layout-budget customer (LB-001): the four chains (complaint resolved then a review task, an AI draft approved then sent,
 * a suppressed decision, an ad recommendation applied) plus a dozen routine actions so the Why tab is as busy as a real customer's. Everything is fake and labelled.
 * Local database only. Idempotent (a marker on each row). Needs the standard seed first.
 *
 *   npx tsx scripts/layout-budget/seed-ledger.ts      (also part of `npm run layout-budget:seed`)
 */
import "dotenv/config";
import "../../src/lib/safety/assert-local-db";

import { prisma } from "../../src/lib/db/prisma";
import { flowCorrelationId } from "../../src/lib/events/envelope";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export async function seedLedger(): Promise<string> {
  const client = await prisma.client.findFirst({ where: { clientCode: "LB-001" }, select: { id: true, assignedToId: true, currentStageId: true } });
  if (!client) return "ledger: LB-001 not found (run the standard seed first)";
  if (await prisma.decisionRecord.findFirst({ where: { correlationId: "corr_lb-ledger-1" }, select: { id: true } })) return "ledger: already seeded";
  const rm = client.assignedToId ?? (await prisma.user.findFirstOrThrow({ where: { email: "rm@supportify.local" } })).id;
  const marketing = await prisma.user.findFirst({ where: { role: "MARKETING" }, select: { id: true } });
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" }, select: { id: true } });
  const now = Date.now();
  const t = (ms: number) => new Date(now - ms);
  const flow = flowCorrelationId(client.id);
  const c = client.id;

  // 1. complaint resolved, then a review task an hour later (no id between them: the link is inferred)
  const insight = await prisma.conversationInsight.create({ data: { clientId: c, kind: "COMPLAINT", text: "Synthetic example complaint", severity: "high", sourceType: "NOTE", sourceRef: "lb-ledger-i1", dedupeKey: "lb-ledger-i1", occurredAt: t(9 * DAY) } });
  const complaint = await prisma.complaint.create({ data: { clientId: c, title: "Example: statement delay", severity: "HIGH", status: "RESOLVED", ownerId: rm, sourceType: "INSIGHT", insightId: insight.id, openedAt: t(9 * DAY), slaDueAt: t(7 * DAY), resolvedAt: t(7 * DAY), resolutionCode: "explained" } });
  await prisma.complaintEvent.createMany({ data: [{ complaintId: complaint.id, type: "opened", at: t(9 * DAY) }, { complaintId: complaint.id, type: "resolved", actorId: rm, at: t(7 * DAY) }] });
  await prisma.task.create({ data: { clientId: c, assignedToId: rm, title: "Example: schedule customer review call", dueAt: new Date(now + 3 * DAY), category: "MEETING", source: "manual", createdAt: new Date(t(7 * DAY).getTime() + HOUR) } });
  await prisma.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-1b0000000001", eventType: "complaint.raised", occurredAt: t(9 * DAY), actorType: "system", clientId: c, source: "crm.web", correlationId: flow, dataClass: "PERSONAL", dedupeKey: "crm.web:lb-ledger-i1:complaint.raised", metadata: { ref: { table: "ConversationInsight", id: insight.id }, severity: "HIGH", via: "conversation" } } });

  // 2. engine recommends, the nudger drafts (two runs), the RM approves, it is sent, the customer replies
  const decision = await prisma.decisionRecord.create({ data: decisionData(c, "lb-ledger-1", t(5 * DAY), "RECOMMEND", "ACCEPTED") });
  await prisma.decisionFeedback.create({ data: { decisionId: decision.id, userId: rm, kind: "accept", createdAt: new Date(t(5 * DAY).getTime() + 10 * MIN) } });
  const runCorr = "7f1d0b0a-3333-4222-8333-444455556688";
  for (const [purpose, min] of [["nudger.draft", 3], ["compliance.judge", 3.2]] as const) {
    await prisma.agentRun.create({ data: { agentKey: "wa_nudger", purposeId: purpose, provider: "fake", model: "fake", promptId: "p", promptVersion: "1", inputClass: "customer_facts", status: "OK", correlationId: runCorr, subjectType: "client", subjectId: c, retainUntil: new Date(now + 90 * DAY), createdAt: new Date(t(5 * DAY).getTime() + min * MIN), costUsdEstimate: 0.0012 } });
  }
  const msg = await prisma.message.create({ data: { clientId: c, channel: "whatsapp", provider: "openwa", direction: "OUTBOUND", body: "Synthetic example message", status: "DELIVERED", origin: "crm", senderUserId: rm, createdAt: new Date(t(5 * DAY).getTime() + 20 * MIN) } });
  const reply = await prisma.message.create({ data: { clientId: c, channel: "whatsapp", provider: "openwa", direction: "INBOUND", body: "Synthetic example reply", status: "READ", origin: "customer", createdAt: t(4 * DAY) } });
  const prop = await prisma.agentProposal.create({ data: { agentKey: "wa_nudger", clientId: c, programme: "kyc", channel: "whatsapp", body: "Synthetic example draft", originalBody: "Synthetic example draft", reason: "KYC pending", status: "SENT", provider: "fake", model: "fake", decidedById: rm, decidedAt: new Date(t(5 * DAY).getTime() + 20 * MIN), messageId: msg.id, createdAt: new Date(t(5 * DAY).getTime() + 4 * MIN), expiresAt: new Date(now + DAY), nbaDecisionId: decision.id } });
  await prisma.decisionOutcome.create({ data: { decisionId: decision.id, kind: "response", eventRef: reply.id, occurredAt: t(4 * DAY), daysAfter: 1 } });
  await prisma.auditLog.create({ data: { userId: rm, entity: "Approval", entityId: `agent-proposal:${prop.id}`, action: "approval_approved", newValue: { kind: "agent-proposal", state: "executed", correlationId: `approval:agent-proposal:${prop.id}`, autonomy: "L4" }, timestamp: new Date(t(5 * DAY).getTime() + 20 * MIN) } });
  await prisma.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-1b0000000002", eventType: "whatsapp.message.sent", occurredAt: new Date(t(5 * DAY).getTime() + 20 * MIN), actorType: "user", actorId: rm, clientId: c, source: "whatsapp.worker", correlationId: flow, dataClass: "PERSONAL", dedupeKey: `whatsapp.worker:${msg.id}:whatsapp.message.sent`, metadata: { ref: { table: "Message", id: msg.id }, channel: "whatsapp" }, consentContext: { purpose: "MARKETING_COMMS", status: "GRANTED" } } });

  // 3. the engine decides not to contact (an open complaint blocks the nudge)
  await prisma.decisionRecord.create({ data: decisionData(c, "lb-ledger-2", t(DAY), "NO_ACTION", "OPEN", [{ rule: "open_complaint", effect: "block", until: null, because: "An open complaint blocks nudges", candidateId: "stage_gate:kyc" }]) });

  // 4. an ad recommendation applied (no customer)
  if (marketing) {
    const corr = "9a3c1f00-0000-4000-8000-1b00000000aa";
    const e1 = await prisma.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-1b00000000d1", eventType: "campaign.autopilot.recommended", occurredAt: t(6 * HOUR), actorType: "agent", actorId: "autopilot", source: "meta.ads", correlationId: corr, dataClass: "INTERNAL", dedupeKey: "meta.ads:lb-rec:recommended", metadata: { recommendationId: "lb-rec" } } });
    const e2 = await prisma.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-1b00000000d2", eventType: "campaign.autopilot.approved", occurredAt: t(5 * HOUR), actorType: "user", actorId: marketing.id, source: "crm.web", correlationId: corr, causationId: e1.eventId, dataClass: "INTERNAL", dedupeKey: "crm.web:lb-rec:approved", metadata: { recommendationId: "lb-rec" } } });
    await prisma.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-1b00000000d3", eventType: "campaign.autopilot.applied", occurredAt: t(5 * HOUR - 5 * MIN), actorType: "system", source: "meta.ads", correlationId: corr, causationId: e2.eventId, dataClass: "INTERNAL", dedupeKey: "meta.ads:lb-rec:applied", metadata: { recommendationId: "lb-rec" } } });
    await prisma.approvalRequest.create({ data: { actionType: "AUTOPILOT_ACTION", entity: "AdCampaign", entityId: "lb-camp", status: "APPROVED", payload: {}, requestedById: admin.id, requestedAt: t(6 * HOUR - MIN), decidedById: marketing.id, decidedAt: t(5 * HOUR), appliedAt: t(5 * HOUR - 5 * MIN), correlationId: corr, autonomyLevel: "L4" } });
    await prisma.customerEvent.create({ data: { eventId: "00000000-0000-4000-8000-1b00000000d4", eventType: "campaign.lead.attributed", occurredAt: t(HOUR), actorType: "system", clientId: c, source: "crm.web", correlationId: flow, dataClass: "PERSONAL", dedupeKey: "crm.web:lb-ledger:campaign.lead.attributed", metadata: { campaignId: "lb-camp" } } });
  }

  // routine actions: tasks, consent changes, stage changes, more sent messages
  for (let i = 0; i < 6; i++) await prisma.task.create({ data: { clientId: c, assignedToId: rm, title: `Example: routine follow-up ${i + 1}`, dueAt: new Date(now + (i + 1) * DAY), source: i % 2 ? "stage-engine" : "manual", createdAt: t((12 + i * 3) * DAY) } });
  for (const [i, status] of (["GRANTED", "WITHDRAWN", "GRANTED"] as const).entries()) await prisma.consentRecord.create({ data: { clientId: c, purpose: "MARKETING_COMMS", channel: "WHATSAPP", status, source: i === 1 ? "whatsapp_keyword" : "crm", capturedAt: t((30 - i * 6) * DAY), ...(i === 1 ? {} : { capturedById: rm }) } });
  for (let i = 0; i < 3; i++) await prisma.message.create({ data: { clientId: c, channel: "whatsapp", provider: "openwa", direction: "OUTBOUND", body: "Synthetic routine message", status: "SENT", origin: "crm", senderUserId: rm, createdAt: t((14 + i * 2) * DAY) } });
  return "ledger: seeded four chains and routine actions for LB-001";
}

function decisionData(clientId: string, key: string, createdAt: Date, result: string, status: string, suppression: unknown[] = []) {
  return {
    clientId, engineVersion: "v2.0.0-shadow", correlationId: `corr_${key}`, result, action: result === "NO_ACTION" ? "no_action" : "nudge", programme: "kyc", reason: result === "NO_ACTION" ? "A formal complaint is open" : "KYC pending for 6 days",
    priority: "high", priorityScore: 70, owner: "RM", channel: "whatsapp", timing: "today", confidence: "medium",
    evidence: [{ kind: "fact", ref: "stage:KYC", text: "Customer is in the KYC stage", observedAt: createdAt.toISOString(), confirmation: "confirmed" }, { kind: "event", ref: "event:kyc-started", text: "KYC started 6 days ago", observedAt: createdAt.toISOString(), confirmation: "confirmed" }],
    scoreInputs: [], suppression: suppression as object, policyResult: { consent: "ok", consentPurpose: "MARKETING_COMMS", consentReason: null, window: "ok", guardrails: "ok", approvalNeeded: result !== "NO_ACTION", approver: "RM" },
    alternatives: [], inputHash: key, status, observedAt: createdAt, createdAt,
  };
}

if (require.main === module || process.argv[1]?.endsWith("seed-ledger.ts")) {
  seedLedger().then((m) => { console.log(m); return prisma.$disconnect(); }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
