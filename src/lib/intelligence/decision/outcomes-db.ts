// Later events on the customer, linked to decisions (DecisionOutcome). Correlation, not causation. Idempotent: the unique key is
// (decision, kind, event), so re-running adds nothing.
import { basePrisma } from "@/lib/db/prisma";
import { DAY_MS } from "./constants";
import { linkOutcomes, type LaterEvent } from "./outcome-linking";
import { liveEventSink } from "./seams-live";

/** Events for one customer between two moments, in the vocabulary of DecisionOutcome. */
export async function loadLaterEvents(clientId: string, from: Date, to: Date): Promise<LaterEvent[]> {
  const range = { gt: from, lte: to };
  const [activities, inbound, outcomes, kyc, funding, complaints] = await Promise.all([
    basePrisma.activity.findMany({ where: { clientId, type: { in: ["CALL", "MEETING", "CONTACT"] }, createdAt: range }, select: { id: true, createdAt: true, type: true }, take: 50 }),
    basePrisma.message.findMany({ where: { clientId, direction: "INBOUND", createdAt: range }, select: { id: true, createdAt: true }, take: 50 }),
    basePrisma.interactionOutcome.findMany({ where: { clientId, createdAt: range }, select: { id: true, createdAt: true, assetClass: true, outcome: true }, take: 50 }),
    basePrisma.kycRecord.findFirst({ where: { clientId, status: "APPROVED", completionDate: range }, select: { id: true, completionDate: true } }),
    basePrisma.clientPayment.findMany({ where: { clientId, paymentType: "FUNDS_IN", status: "SUCCESS", paidAt: range }, select: { id: true, paidAt: true }, orderBy: { paidAt: "asc" }, take: 1 }),
    basePrisma.conversationInsight.findMany({ where: { clientId, kind: "COMPLAINT", resolvedAt: range }, select: { id: true, resolvedAt: true }, take: 5 }),
  ]);
  return [
    ...activities.map((a): LaterEvent => ({ kind: "contact", ref: `activity:${a.id}`, at: a.createdAt, detail: a.type })),
    ...inbound.map((m): LaterEvent => ({ kind: "response", ref: `message:${m.id}`, at: m.createdAt })),
    ...outcomes.map((o): LaterEvent => ({ kind: "interaction_outcome", ref: `outcome:${o.id}`, at: o.createdAt, assetClass: o.assetClass, detail: o.outcome })),
    ...(kyc?.completionDate ? [{ kind: "kyc" as const, ref: `kyc:${kyc.id}`, at: kyc.completionDate }] : []),
    ...funding.map((p): LaterEvent => ({ kind: "funding", ref: `payment:${p.id}`, at: p.paidAt })),
    ...complaints.flatMap((c): LaterEvent[] => (c.resolvedAt ? [{ kind: "complaint_resolved", ref: `insight:${c.id}`, at: c.resolvedAt }] : [])),
  ];
}

/** Links events to this customer's decisions from the last 35 days. Returns how many new links were written. */
export async function linkOutcomesForClient(clientId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 35 * DAY_MS);
  const decisions = await basePrisma.decisionRecord.findMany({ where: { clientId, createdAt: { gte: since }, result: { not: "ABSTAIN" } }, select: { id: true, clientId: true, createdAt: true, assetClass: true, result: true } });
  if (decisions.length === 0) return 0;
  const events = await loadLaterEvents(clientId, since, now);
  let written = 0;
  for (const d of decisions) {
    const drafts = linkOutcomes({ id: d.id, clientId: d.clientId, createdAt: d.createdAt, assetClass: d.assetClass, result: d.result }, events);
    if (drafts.length === 0) continue;
    const res = await basePrisma.decisionOutcome.createMany({ data: drafts.map((o) => ({ decisionId: o.decisionId, kind: o.kind, eventRef: o.eventRef, occurredAt: o.occurredAt, daysAfter: o.daysAfter, detail: o.detail })), skipDuplicates: true });
    written += res.count;
    // nba.outcome.linked through emit(): idempotent by (decision, outcome kind), so re-linking never stores a second event; a no-op with the events flag off.
    if (res.count > 0) for (const o of drafts) await liveEventSink.emit({ type: "nba.decision.outcome", clientId: d.clientId, decisionId: d.id, correlationId: d.id, payload: { kind: o.kind } });
  }
  return written;
}
