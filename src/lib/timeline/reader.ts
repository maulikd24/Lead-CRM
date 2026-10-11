import { can } from "@/lib/access/policy";
import { canOpen360 } from "@/lib/clients/access";
import { dropMirroredMessageActivities } from "@/lib/c360/timeline";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";
import { customerEventsEnabled } from "@/lib/events/flag";
import type { Role } from "@/generated/prisma/client";

import {
  activityItem, assemble, consentItem, decodeCursor, eventItem, goalItem, insightItem, journeyItem, messageItem, milestoneItems, outcomeItem, proposalItem, referralItem, reviewItem, stageItem, taskItems, ticketItem, transactionItem,
  type Freshness, type SourceResult, type TimelineItem,
} from "./model";

/**
 * getCustomerTimeline: THE canonical customer timeline reader. It composes the domain tables (activities, messages, tasks, tickets,
 * consent, stage changes, transactions, outcomes, agent drafts, journeys, complaints and commitments, KYC and funding milestones, goals, referrals) and,
 * when events are on, CustomerEvent facts that no domain item already stands for. There is no replacement history table: every item carries a source ref
 * back to the authoritative record and an as-of time.
 *
 * Access: it checks for itself. Only roles that hold `client-360` view may read a customer timeline at all (Marketing never does: default deny, and the
 * marketing rule), and the customer must be one the viewer may open (same rule as the Customer 360 page); anything else is "not found", so the answer
 * cannot be used to learn whose customer it is. Read only: it never writes, never refreshes intelligence, never fires a journey.
 */

export type TimelineViewer = { id: string; role: Role };
export type TimelineOptions = { viewer: TimelineViewer; limit?: number; before?: string | null; includeEvents?: boolean; now?: Date };
export type TimelineResult = { ok: true; items: TimelineItem[]; nextCursor: string | null; olderNotShown: boolean; freshness: Freshness } | { ok: false; reason: "forbidden" | "not_found" };

const SLACK = 20;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function getCustomerTimeline(clientId: string, o: TimelineOptions): Promise<TimelineResult> {
  if (!can(o.viewer.role, "client-360", "view")) return { ok: false, reason: "forbidden" };
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { assignedToId: true, isDeleted: true, mergedIntoId: true } });
  if (!client) return { ok: false, reason: "not_found" };
  const visible = await getVisibleUserIds(o.viewer.id, o.viewer.role);
  if (!canOpen360(o.viewer.role, visible, client)) return { ok: false, reason: "not_found" };

  const now = o.now ?? new Date();
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(o.limit ?? DEFAULT_LIMIT)));
  const take = limit + SLACK;
  const cursor = decodeCursor(o.before);
  const upTo = (field: string) => (cursor ? { [field]: { lte: new Date(cursor.at) } } : {});
  const withEvents = o.includeEvents ?? customerEventsEnabled();

  const [activities, messages, outcomes, proposals, runs, transactions, tasks, tickets, consents, stages, insights, kyc, funding, goals, reviews, referral, events] = await Promise.all([
    prisma.activity.findMany({ where: { clientId, ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take, select: { id: true, type: true, payload: true, createdAt: true, user: { select: { name: true } }, deviceCall: { select: { direction: true, durationSeconds: true } } } }),
    prisma.message.findMany({ where: { clientId, ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take, select: { id: true, channel: true, direction: true, body: true, status: true, createdAt: true } }),
    prisma.interactionOutcome.findMany({ where: { clientId, ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take, select: { id: true, outcome: true, channel: true, assetClass: true, note: true, summary: true, createdAt: true } }),
    prisma.agentProposal.findMany({ where: { clientId, ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take, select: { id: true, status: true, channel: true, body: true, reason: true, createdAt: true } }),
    prisma.journeyRun.findMany({ where: { clientId, ...upTo("startedAt") }, orderBy: { startedAt: "desc" }, take, select: { id: true, status: true, startedAt: true, journey: { select: { name: true } } } }),
    prisma.transaction.findMany({ where: { tradingAccount: { clientId }, ...upTo("transactionDate") }, orderBy: { transactionDate: "desc" }, take, select: { id: true, transactionType: true, transactionDate: true, grossAmount: true, product: { select: { name: true } } } }),
    prisma.task.findMany({ where: { clientId, ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take, select: { id: true, title: true, status: true, dueAt: true, createdAt: true, updatedAt: true } }),
    prisma.supportTicket.findMany({ where: { clientId, ...(cursor ? { OR: [{ ticketCreatedAt: { lte: new Date(cursor.at) } }, { ticketCreatedAt: null }] } : {}) }, orderBy: [{ ticketCreatedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take, select: { id: true, status: true, subject: true, ticketCreatedAt: true, createdAt: true, updatedAt: true, activityId: true } }),
    prisma.consentRecord.findMany({ where: { clientId, ...upTo("capturedAt") }, orderBy: { capturedAt: "desc" }, take, select: { id: true, purpose: true, channel: true, status: true, capturedAt: true, source: true } }),
    prisma.stageHistory.findMany({ where: { clientId, ...upTo("changedAt") }, orderBy: { changedAt: "desc" }, take, select: { id: true, changedAt: true, reason: true, slaMet: true, fromStage: { select: { name: true } }, toStage: { select: { name: true } }, changedBy: { select: { name: true } } } }),
    prisma.conversationInsight.findMany({ where: { clientId, kind: { in: ["COMPLAINT", "COMMITMENT"] }, ...upTo("occurredAt") }, orderBy: { occurredAt: "desc" }, take, select: { id: true, kind: true, status: true, text: true, severity: true, dueAt: true, occurredAt: true, resolvedAt: true, createdAt: true } }),
    prisma.kycRecord.findUnique({ where: { clientId }, select: { id: true, status: true, submissionDate: true, completionDate: true, updatedAt: true } }),
    prisma.fundingRecord.findUnique({ where: { clientId }, select: { id: true, status: true, fundingDate: true, updatedAt: true } }),
    prisma.customerGoal.findMany({ where: { clientId, ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take, select: { id: true, name: true, createdAt: true, updatedAt: true } }),
    prisma.customerReview.findMany({ where: { clientId, ...upTo("reviewedAt") }, orderBy: { reviewedAt: "desc" }, take, select: { id: true, reviewedAt: true, createdAt: true } }),
    prisma.referral.findUnique({ where: { referredClientId: clientId }, select: { id: true, outcome: true, attributedAt: true } }),
    withEvents ? prisma.customerEvent.findMany({ where: { clientId, ...upTo("occurredAt") }, orderBy: { occurredAt: "desc" }, take, select: { id: true, eventType: true, occurredAt: true, receivedAt: true, actorType: true, metadata: true, late: true, schemaVersion: true } }) : Promise.resolve([]),
  ]);

  const activityInputs = activities.map((a) => ({ id: a.id, type: a.type, payload: a.payload, createdAt: a.createdAt, userName: a.user?.name ?? null, call: a.deviceCall }));
  const completedActivities = activityInputs.filter((a) => a.type === "TASK_COMPLETED").map((a) => ({ id: a.id, message: String((a.payload as { message?: unknown } | null)?.message ?? ""), at: a.createdAt }));
  const results: SourceResult[] = [
    // A CRM message is stored as a Message row AND a MESSAGE activity: show it once (the row), keep provider events. Same rule as the Customer 360 timeline.
    { source: "activity", items: dropMirroredMessageActivities(activityInputs, messages).map(activityItem), capped: activities.length >= take },
    { source: "message", items: messages.map(messageItem), capped: messages.length >= take },
    { source: "outcome", items: outcomes.map(outcomeItem), capped: outcomes.length >= take },
    { source: "agent", items: proposals.map(proposalItem), capped: proposals.length >= take },
    { source: "journey", items: runs.map((r) => journeyItem({ id: r.id, journeyName: r.journey.name, status: r.status, startedAt: r.startedAt })), capped: runs.length >= take },
    { source: "transaction", items: transactions.map((t) => transactionItem({ id: t.id, type: t.transactionType, productName: t.product?.name ?? null, amount: Number(t.grossAmount), date: t.transactionDate })), capped: transactions.length >= take },
    { source: "task", items: tasks.flatMap((t) => taskItems(t, { completedActivities, now })), capped: tasks.length >= take },
    { source: "ticket", items: tickets.map((t) => ticketItem({ ...t, isComplaint: false })), capped: tickets.length >= take },
    { source: "consent", items: consents.map(consentItem), capped: consents.length >= take },
    { source: "stage", items: stages.map((s) => stageItem({ id: s.id, fromStage: s.fromStage?.name ?? null, toStage: s.toStage.name, changedAt: s.changedAt, byName: s.changedBy?.name ?? null, reason: s.reason, slaMet: s.slaMet })), capped: stages.length >= take },
    { source: "insight", items: insights.map(insightItem).filter((i): i is TimelineItem => i !== null), capped: insights.length >= take },
    { source: "milestone", items: milestoneItems(kyc, funding), capped: false },
    { source: "goal", items: [...goals.map(goalItem), ...reviews.map(reviewItem)], capped: goals.length >= take || reviews.length >= take },
    { source: "referral", items: referral ? [referralItem(referral)] : [], capped: false },
  ];
  if (withEvents) results.push({ source: "event", items: events.map(eventItem).filter((i): i is TimelineItem => i !== null), capped: events.length >= take });

  const out = assemble(results, { limit, before: o.before, now });
  return { ok: true, ...out };
}
