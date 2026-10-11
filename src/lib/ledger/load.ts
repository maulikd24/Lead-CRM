import { prisma } from "@/lib/db/prisma";

import type { ApprovalRow, AuditRow, Bundle, ComplaintRow, ConsentRow, DecisionRow, EventRow, MessageRow, ProposalRow, RunRow, StageRow, TaskRow } from "./bundle";
import { emptyBundle } from "./bundle";
import type { LedgerQueryStats } from "./types";

/**
 * The loaders: bounded, indexed reads that fill a Bundle. No loader reads a message body, a draft body, a conversation text, a phone, an email or a PAN (the selects
 * name only the columns the ledger shows or joins on). Every query is bounded by `take`, so the cost does not grow with the customer's history.
 *
 * Statement count for one customer page (reported in `stats`; a nested include is counted as the extra statement Prisma issues for it):
 *   round 1 (parallel): events, decisions (+ feedback, outcomes), drafts, outbound messages, tasks, consents, complaints (+ events), stage changes   = 12
 *   round 2 (parallel): model runs by correlation id, model runs by subject, approvals by customer, approvals by correlation id, audit rows,
 *                       inbound messages the outcomes name                                                                                     = 6
 *   round 3 (parallel): staff names, stored autonomy levels                                                                                    = 2
 * Indexes used: CustomerEvent(clientId, occurredAt), (correlationId); DecisionRecord(clientId, createdAt); AgentProposal(clientId, createdAt); Message(clientId, createdAt);
 * Task(clientId, createdAt) and AgentRun(subjectType, subjectId, createdAt) from migration 20270530000000; Complaint(clientId, status); ConsentRecord(clientId, ...);
 * StageHistory(clientId, changedAt); ApprovalRequest(entity, entityId), (correlationId); AgentRun(correlationId); AuditLog(entity, entityId).
 */

export type LoadOptions = { limit: number; before?: string | null; includeDecisions: boolean };
export type Loaded = { bundle: Bundle; stats: LedgerQueryStats; capped: boolean };

const MAX_TAKE = 300;
const takeFor = (limit: number) => Math.min(MAX_TAKE, limit * 2 + 20);
const num = (v: { toString(): string } | number | null | undefined): number => (v == null ? 0 : Number(v.toString()));

function counter() {
  const stats: LedgerQueryStats = { queries: 0, rowsRead: 0 };
  return {
    stats,
    async q<T extends unknown[]>(promise: Promise<T>, extraStatements = 0): Promise<T> {
      stats.queries += 1 + extraStatements;
      const rows = await promise;
      stats.rowsRead += rows.length;
      return rows;
    },
  };
}

const jsonObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export async function loadClientBundle(clientId: string, o: LoadOptions): Promise<Loaded> {
  const { stats, q } = counter();
  const take = takeFor(o.limit);
  const cursor = o.before && !Number.isNaN(Date.parse(o.before)) ? new Date(o.before) : null;
  const upTo = (field: string) => (cursor ? { [field]: { lte: cursor } } : {});
  let capped = false;
  const cap = (rows: unknown[]) => { if (rows.length >= take) capped = true; };

  const [events, decisions, proposals, outbound, tasks, consents, complaints, stages] = await Promise.all([
    q(prisma.customerEvent.findMany({ where: { clientId, ...upTo("occurredAt") }, orderBy: { occurredAt: "desc" }, take, select: { id: true, eventId: true, eventType: true, occurredAt: true, actorType: true, actorId: true, clientId: true, source: true, correlationId: true, causationId: true, metadata: true, consentContext: true } })),
    o.includeDecisions
      ? q(prisma.decisionRecord.findMany({
          where: { clientId, ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take,
          select: {
            id: true, clientId: true, engineVersion: true, correlationId: true, causationId: true, mode: true, result: true, abstainReason: true, action: true, programme: true, topic: true, reason: true, priority: true, channel: true,
            evidence: true, suppression: true, policyResult: true, status: true, observedAt: true, createdAt: true,
            feedback: { select: { id: true, userId: true, kind: true, reason: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 10 },
            outcomes: { select: { id: true, kind: true, eventRef: true, occurredAt: true, daysAfter: true }, orderBy: { occurredAt: "asc" }, take: 10 },
          },
        }), 2)
      : Promise.resolve([]),
    q(prisma.agentProposal.findMany({ where: { clientId, ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take, select: { id: true, agentKey: true, clientId: true, programme: true, channel: true, status: true, blockedReason: true, decidedById: true, decidedAt: true, messageId: true, createdAt: true, expiresAt: true, nbaDecisionId: true } })),
    q(prisma.message.findMany({ where: { clientId, direction: "OUTBOUND", ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take, select: { id: true, clientId: true, channel: true, provider: true, direction: true, templateId: true, status: true, origin: true, senderUserId: true, createdAt: true, sentAt: true } })),
    q(prisma.task.findMany({ where: { clientId, ...upTo("createdAt") }, orderBy: { createdAt: "desc" }, take, select: { id: true, clientId: true, assignedToId: true, title: true, dueAt: true, status: true, category: true, source: true, createdAt: true, updatedAt: true } })),
    q(prisma.consentRecord.findMany({ where: { clientId, ...upTo("capturedAt") }, orderBy: { capturedAt: "desc" }, take, select: { id: true, clientId: true, purpose: true, channel: true, status: true, source: true, capturedAt: true, capturedById: true } })),
    q(prisma.complaint.findMany({
      where: { clientId, ...upTo("openedAt") }, orderBy: { openedAt: "desc" }, take,
      select: { id: true, clientId: true, severity: true, status: true, ownerId: true, sourceType: true, taskId: true, insightId: true, supportTicketId: true, openedAt: true, acknowledgedAt: true, resolvedAt: true, closedAt: true, resolutionCode: true, createdById: true, events: { select: { id: true, type: true, actorId: true, at: true }, orderBy: { at: "asc" }, take: 20 } },
    }), 1),
    q(prisma.stageHistory.findMany({ where: { clientId, ...upTo("changedAt") }, orderBy: { changedAt: "desc" }, take, select: { id: true, clientId: true, changedById: true, changedAt: true, reason: true, fromStage: { select: { name: true } }, toStage: { select: { name: true } } } })),
  ]);
  for (const r of [events, decisions, proposals, outbound, tasks, consents, complaints, stages]) cap(r);

  const correlationIds = new Set<string>();
  for (const e of events) correlationIds.add(e.correlationId);
  for (const d of decisions) correlationIds.add(d.correlationId);
  const inboundIds = decisions.flatMap((d) => d.outcomes.map((x) => x.eventRef));
  const proposalRefs = proposals.map((p) => `agent-proposal:${p.id}`);
  const taskIds = tasks.map((t) => t.id);
  const decisionIds = decisions.map((d) => d.id);
  const complaintIds = complaints.map((c) => c.id);
  const earliest = [events.at(-1)?.occurredAt, outbound.at(-1)?.createdAt, tasks.at(-1)?.createdAt].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date(0);

  const [runsByCorr, runsBySubject, approvalsByClient, approvalsByCorr, audits, inbound] = await Promise.all([
    correlationIds.size ? q(prisma.agentRun.findMany({ where: { correlationId: { in: [...correlationIds] } }, take, orderBy: { createdAt: "desc" }, select: RUN_SELECT })) : Promise.resolve([]),
    q(prisma.agentRun.findMany({ where: { subjectType: "client", subjectId: clientId, createdAt: { gte: new Date(earliest.getTime() - 3_600_000) }, ...(cursor ? { createdAt: { gte: new Date(earliest.getTime() - 3_600_000), lte: cursor } } : {}) }, take, orderBy: { createdAt: "desc" }, select: RUN_SELECT })),
    q(prisma.approvalRequest.findMany({ where: { entity: { in: ["Client", "Customer message"] }, entityId: clientId }, take, orderBy: { requestedAt: "desc" }, select: APPROVAL_SELECT })),
    correlationIds.size ? q(prisma.approvalRequest.findMany({ where: { correlationId: { in: [...correlationIds] } }, take, select: APPROVAL_SELECT })) : Promise.resolve([]),
    q(prisma.auditLog.findMany({
      where: { OR: [{ entity: "Client", entityId: clientId }, ...(proposalRefs.length ? [{ entity: "Approval", entityId: { in: proposalRefs } }] : []), ...(taskIds.length ? [{ entity: "Task", entityId: { in: taskIds } }] : []), ...(decisionIds.length ? [{ entity: "DecisionRecord", entityId: { in: decisionIds } }] : []), ...(complaintIds.length ? [{ entity: "Complaint", entityId: { in: complaintIds } }] : [])] },
      orderBy: { timestamp: "desc" }, take, select: { id: true, userId: true, entity: true, entityId: true, action: true, timestamp: true, newValue: true },
    })),
    inboundIds.length ? q(prisma.message.findMany({ where: { id: { in: inboundIds }, clientId, direction: "INBOUND" }, select: MESSAGE_SELECT })) : Promise.resolve([]),
  ]);

  const runs = dedupe([...runsByCorr, ...runsBySubject], (r) => r.id).filter((r) => r.subjectType === null || r.subjectType !== "client" || r.subjectId === clientId);
  // Canonical write-through copies and native requests that name this customer; a request found by correlation id alone must also be about this customer or carry none.
  const approvals = dedupe([...approvalsByClient, ...approvalsByCorr], (a) => a.id).filter((a) => a.entityId === clientId || a.entity !== "Client");

  const userIds = new Set<string>();
  const addUser = (id: string | null | undefined) => { if (id) userIds.add(id); };
  for (const e of events) if (e.actorType === "user") addUser(e.actorId);
  for (const d of decisions) for (const f of d.feedback) addUser(f.userId);
  for (const p of proposals) addUser(p.decidedById);
  for (const m of outbound) addUser(m.senderUserId);
  for (const t of tasks) addUser(t.assignedToId);
  for (const c of consents) addUser(c.capturedById);
  for (const c of complaints) { addUser(c.ownerId); addUser(c.createdById); for (const e of c.events) addUser(e.actorId); }
  for (const s of stages) addUser(s.changedById);
  for (const a of approvals) { addUser(a.requestedById); addUser(a.decidedById); }
  for (const a of audits) addUser(a.userId);
  const agentKeys = [...new Set([...proposals.map((p) => p.agentKey), ...runs.map((r) => r.agentKey).filter((k): k is string => !!k), ...events.filter((e) => e.actorType === "agent" && e.actorId).map((e) => e.actorId as string), "nba_engine"])];

  const [userRows, autonomyRows] = await Promise.all([
    userIds.size ? q(prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })) : Promise.resolve([]),
    q(prisma.agentAutonomy.findMany({ where: { agentKey: { in: agentKeys } }, select: { agentKey: true, actionType: true, level: true } })),
  ]);

  const bundle = emptyBundle(clientId);
  bundle.events = events.map(toEvent);
  bundle.decisions = decisions.map(toDecision);
  bundle.runs = runs.map(toRun);
  bundle.proposals = proposals.map((p): ProposalRow => ({ ...p }));
  bundle.approvals = approvals.map(toApproval);
  bundle.audits = audits.map((a): AuditRow => ({ ...a }));
  bundle.messages = [...outbound, ...inbound].map((m): MessageRow => ({ ...m, direction: m.direction }));
  bundle.tasks = tasks.map((t): TaskRow => ({ ...t }));
  bundle.consents = consents.map((c): ConsentRow => ({ ...c }));
  bundle.complaints = complaints.map((c): ComplaintRow => ({ ...c, events: c.events }));
  bundle.stages = stages.map((s): StageRow => ({ id: s.id, clientId: s.clientId, fromStage: s.fromStage?.name ?? null, toStage: s.toStage.name, changedById: s.changedById, changedAt: s.changedAt, reason: s.reason }));
  bundle.users = new Map(userRows.map((u) => [u.id, u.name]));
  bundle.autonomy = new Map(autonomyRows.map((a) => [`${a.agentKey}:${a.actionType}`, a.level]));
  return { bundle, stats, capped };
}

const RUN_SELECT = { id: true, createdAt: true, agentKey: true, purposeId: true, status: true, reasonCode: true, correlationId: true, causationId: true, subjectType: true, subjectId: true, approvalRef: true, costUsdEstimate: true, model: true } as const;
const APPROVAL_SELECT = { id: true, actionType: true, entity: true, entityId: true, status: true, requestedById: true, requestedAt: true, decidedById: true, decidedAt: true, decisionNote: true, appliedAt: true, correlationId: true, causationId: true, autonomyLevel: true, payload: true } as const;
const MESSAGE_SELECT = { id: true, clientId: true, channel: true, provider: true, direction: true, templateId: true, status: true, origin: true, senderUserId: true, createdAt: true, sentAt: true } as const;

function dedupe<T>(rows: T[], idOf: (r: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) if (!seen.has(idOf(r))) seen.set(idOf(r), r);
  return [...seen.values()];
}

type Dec = Awaited<ReturnType<typeof prisma.decisionRecord.findMany>>[number];
const toEvent = (e: { id: string; eventId: string; eventType: string; occurredAt: Date; actorType: string; actorId: string | null; clientId: string | null; source: string; correlationId: string; causationId: string | null; metadata: unknown; consentContext: unknown }): EventRow => ({ ...e });
const toDecision = (d: unknown): DecisionRow => d as DecisionRow;
void (null as unknown as Dec);
const toRun = (r: { id: string; createdAt: Date; agentKey: string | null; purposeId: string; status: string; reasonCode: string | null; correlationId: string; causationId: string | null; subjectType: string | null; subjectId: string | null; approvalRef: string | null; costUsdEstimate: { toString(): string } | number; model: string }): RunRow => ({ ...r, costUsdEstimate: num(r.costUsdEstimate) });
const toApproval = (a: { id: string; actionType: string; entity: string; entityId: string; status: string; requestedById: string; requestedAt: Date; decidedById: string | null; decidedAt: Date | null; decisionNote: string | null; appliedAt: Date | null; correlationId: string | null; causationId: string | null; autonomyLevel: string | null; payload: unknown }): ApprovalRow => {
  const p = jsonObj(a.payload);
  const mirror = p.mirror === true && typeof p.kind === "string" && typeof p.subjectId === "string" ? { kind: p.kind, subjectId: p.subjectId } : null;
  const { payload: _payload, ...rest } = a;
  void _payload;
  return { ...rest, mirror };
};

// ---- other subjects (Admin investigation, and the campaign view) ---------------------------------------------------------------------------------

/** Everything the ledger can name from a correlation id: events, model runs, approvals, decisions. The customers found are returned so the caller can load each customer's bundle. */
export async function findByCorrelation(correlationId: string): Promise<{ clientIds: string[]; stats: LedgerQueryStats; seeds: { events: number; runs: number; approvals: number; decisions: number } }> {
  const { stats, q } = counter();
  const [events, runs, approvals, decisions] = await Promise.all([
    q(prisma.customerEvent.findMany({ where: { correlationId }, take: 100, orderBy: { occurredAt: "desc" }, select: { clientId: true } })),
    q(prisma.agentRun.findMany({ where: { correlationId }, take: 100, select: { subjectType: true, subjectId: true } })),
    q(prisma.approvalRequest.findMany({ where: { correlationId }, take: 100, select: { entity: true, entityId: true } })),
    q(prisma.decisionRecord.findMany({ where: { correlationId }, take: 100, select: { clientId: true } })),
  ]);
  const ids = new Set<string>();
  for (const e of events) if (e.clientId) ids.add(e.clientId);
  for (const r of runs) if (r.subjectType === "client" && r.subjectId) ids.add(r.subjectId);
  for (const a of approvals) if (a.entity === "Client" || a.entity === "Customer message") ids.add(a.entityId);
  for (const d of decisions) ids.add(d.clientId);
  return { clientIds: [...ids], stats, seeds: { events: events.length, runs: runs.length, approvals: approvals.length, decisions: decisions.length } };
}

export async function findRun(id: string): Promise<{ correlationId: string; clientId: string | null; stats: LedgerQueryStats } | null> {
  const { stats, q } = counter();
  const [row] = await q(prisma.agentRun.findMany({ where: { id }, take: 1, select: { correlationId: true, subjectType: true, subjectId: true } }));
  return row ? { correlationId: row.correlationId, clientId: row.subjectType === "client" ? row.subjectId : null, stats } : null;
}

/** An approval by ApprovalRequest id, or by canonical reference (`agent-proposal:<id>`). */
export async function findApproval(ref: string): Promise<{ correlationId: string | null; clientId: string | null; table: "ApprovalRequest" | "AgentProposal"; id: string; stats: LedgerQueryStats } | null> {
  const { stats, q } = counter();
  const i = ref.indexOf(":");
  if (i > 0 && ref.slice(0, i) === "agent-proposal") {
    const id = ref.slice(i + 1);
    const [p] = await q(prisma.agentProposal.findMany({ where: { id }, take: 1, select: { clientId: true } }));
    return p ? { correlationId: `approval:agent-proposal:${id}`, clientId: p.clientId, table: "AgentProposal", id, stats } : null;
  }
  const [a] = await q(prisma.approvalRequest.findMany({ where: { id: ref }, take: 1, select: { correlationId: true, entity: true, entityId: true } }));
  return a ? { correlationId: a.correlationId, clientId: a.entity === "Client" || a.entity === "Customer message" ? a.entityId : null, table: "ApprovalRequest", id: ref, stats } : null;
}

/** A bundle of rows that belong to one correlation id and carry no customer: campaign (ad autopilot) chains. */
export async function loadCorrelationBundle(correlationId: string): Promise<Loaded> {
  const { stats, q } = counter();
  const [events, approvals, runs] = await Promise.all([
    q(prisma.customerEvent.findMany({ where: { correlationId }, take: 200, orderBy: { occurredAt: "asc" }, select: { id: true, eventId: true, eventType: true, occurredAt: true, actorType: true, actorId: true, clientId: true, source: true, correlationId: true, causationId: true, metadata: true, consentContext: true } })),
    q(prisma.approvalRequest.findMany({ where: { correlationId }, take: 100, select: APPROVAL_SELECT })),
    q(prisma.agentRun.findMany({ where: { correlationId }, take: 100, select: RUN_SELECT })),
  ]);
  const bundle = emptyBundle(null);
  bundle.events = events.map(toEvent);
  bundle.approvals = approvals.map(toApproval);
  bundle.runs = runs.map(toRun);
  const userIds = new Set<string>();
  for (const e of events) if (e.actorType === "user" && e.actorId) userIds.add(e.actorId);
  for (const a of approvals) { userIds.add(a.requestedById); if (a.decidedById) userIds.add(a.decidedById); }
  const users = userIds.size ? await q(prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })) : [];
  bundle.users = new Map(users.map((u) => [u.id, u.name]));
  return { bundle, stats, capped: false };
}

/** Campaign-level facts for MARKETING: autopilot chains and aggregate counts of lead attribution and conversions. No customer row is read beyond an id that is pseudonymised before it leaves. */
export async function loadCampaignBundle(o: { limit: number; before?: string | null; campaignId: string | null }): Promise<Loaded & { aggregates: { type: string; day: string; count: number; clientIds: string[] }[] }> {
  const { stats, q } = counter();
  const take = takeFor(o.limit);
  const cursor = o.before && !Number.isNaN(Date.parse(o.before)) ? new Date(o.before) : null;
  const events = await q(prisma.customerEvent.findMany({
    where: { eventType: { startsWith: "campaign." }, ...(cursor ? { occurredAt: { lte: cursor } } : {}) }, orderBy: { occurredAt: "desc" }, take: take * 2,
    select: { id: true, eventId: true, eventType: true, occurredAt: true, actorType: true, actorId: true, clientId: true, source: true, correlationId: true, causationId: true, metadata: true, consentContext: true },
  }));
  const wanted = (e: (typeof events)[number]) => !o.campaignId || jsonObj(e.metadata).campaignId === o.campaignId;
  const chain = events.filter((e) => e.eventType.startsWith("campaign.autopilot.") && wanted(e));
  const customerLinked = events.filter((e) => !e.eventType.startsWith("campaign.autopilot.") && wanted(e));
  const corr = [...new Set(chain.map((e) => e.correlationId))];
  const approvals = corr.length ? await q(prisma.approvalRequest.findMany({ where: { correlationId: { in: corr } }, take, select: APPROVAL_SELECT })) : [];
  const bundle = emptyBundle(null);
  bundle.events = chain.map(toEvent).map((e) => ({ ...e, clientId: null }));
  bundle.approvals = approvals.map(toApproval);
  const userIds = new Set<string>();
  for (const e of chain) if (e.actorType === "user" && e.actorId) userIds.add(e.actorId);
  for (const a of approvals) { userIds.add(a.requestedById); if (a.decidedById) userIds.add(a.decidedById); }
  const users = userIds.size ? await q(prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })) : [];
  bundle.users = new Map(users.map((u) => [u.id, u.name]));
  const groups = new Map<string, { type: string; day: string; count: number; clientIds: string[] }>();
  for (const e of customerLinked) {
    const day = e.occurredAt.toISOString().slice(0, 10);
    const k = `${e.eventType}|${day}`;
    const g = groups.get(k) ?? { type: e.eventType, day, count: 0, clientIds: [] };
    g.count += 1;
    if (e.clientId && !g.clientIds.includes(e.clientId)) g.clientIds.push(e.clientId);
    groups.set(k, g);
  }
  return { bundle, stats, capped: events.length >= take * 2, aggregates: [...groups.values()] };
}
