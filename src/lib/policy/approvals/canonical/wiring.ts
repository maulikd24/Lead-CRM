import "../registry-init";

import { APPROVABLE_AGENTS } from "@/lib/agents/decide";
import { pilotDb } from "@/lib/agents/pilot-wiring";
import { decideDeps as agentDecideDeps } from "@/lib/agents/wiring";
import { consentGate } from "@/lib/consent/enforce";
import type { ConsentChannel, ConsentPurpose } from "@/lib/consent/policy";
import { prisma } from "@/lib/db/prisma";
import { decideDeps as mergeDecideDeps } from "@/lib/identity/merge-review/wiring";
import { mergeReviewEnabled } from "@/lib/identity/merge-review/flag";
import { reviewAccess, visibleSide } from "@/lib/identity/merge-review/rm-scope";
import { confidenceOf, firstName, reasonText } from "@/lib/identity/merge-review/view-model";
import { socialService } from "@/lib/marketing/social/store";
import { referralEnabled } from "@/lib/referrals/flag";
import { prismaReferralStore } from "@/lib/referrals/prisma-store";

import { decideApproval } from "../service";
import type { ApprovalAdapter, ApprovalKind } from "./contract";
import { NATIVE_KINDS, type NativeKind } from "./native";
import { writeMirror, writeThroughEnabled } from "./mirror";
import { createAgentProposalAdapter, type AgentRow } from "./adapters/agent-proposal";
import { createAiPilotSignoffAdapter } from "./adapters/ai-pilot-signoff";
import { createApprovalRequestAdapter, type RequestFacts, type RequestRow } from "./adapters/approval-request";
import { createMergeSuggestionAdapter, type MergeRow } from "./adapters/merge-suggestion";
import { createReferralStatementAdapter, type StatementView } from "./adapters/referral-statement";
import { createSocialPostAdapter, type SocialRow } from "./adapters/social-post";
import { createApprovalService, type ApprovalService, type AuditEntry } from "./service";

/** The only file that touches the database for the canonical layer. Each loader is the read half of one legacy path, with that path's own scope rule. */

// ---- agent proposals -------------------------------------------------------------------------------------------------
const agentInclude = { client: { select: { name: true, clientCode: true, assignedToId: true } } } as const;
type AgentDb = Awaited<ReturnType<typeof loadAgentRaw>>[number];
const loadAgentRaw = (where: object, take: number) => prisma.agentProposal.findMany({ where, include: agentInclude, orderBy: { createdAt: "asc" }, take });
const toAgentRow = (p: NonNullable<AgentDb>): AgentRow => ({
  id: p.id, agentKey: p.agentKey, clientId: p.clientId, clientName: p.client.name, clientCode: p.client.clientCode, assignedToId: p.client.assignedToId, status: p.status, body: p.body,
  reason: p.reason, programme: p.programme, channel: p.channel, createdAt: p.createdAt, expiresAt: p.expiresAt, decidedById: p.decidedById, decidedAt: p.decidedAt, blockedReason: p.blockedReason,
});

function agentAdapter(): ApprovalAdapter {
  return createAgentProposalAdapter({
    legacy: agentDecideDeps(),
    loadAwaiting: async (actor, now, limit) => {
      const where = { status: "DRAFT" as const, expiresAt: { gt: now }, agentKey: { in: [...APPROVABLE_AGENTS] }, ...(actor.role === "RM" ? { client: { assignedToId: actor.id } } : {}) };
      return (await loadAgentRaw(where, limit)).map(toAgentRow);
    },
    loadRow: async (id) => {
      const p = await prisma.agentProposal.findUnique({ where: { id }, include: agentInclude });
      return p ? toAgentRow(p) : null;
    },
  });
}

// ---- social posts ------------------------------------------------------------------------------------------------------
async function hydratePosts(posts: Awaited<ReturnType<typeof prisma.socialPost.findMany>>): Promise<SocialRow[]> {
  if (!posts.length) return [];
  const ids = posts.map((p) => p.id);
  const [events, users] = await Promise.all([
    prisma.socialPostEvent.findMany({ where: { postId: { in: ids }, action: "submit" }, orderBy: { createdAt: "desc" }, select: { postId: true, createdAt: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(posts.map((p) => p.createdById))] } }, select: { id: true, name: true } }),
  ]);
  const submitted = new Map<string, Date>();
  for (const e of events) if (!submitted.has(e.postId)) submitted.set(e.postId, e.createdAt);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return posts.map((p) => ({ ...(p as unknown as SocialRow), submittedAt: submitted.get(p.id) ?? p.updatedAt, authorName: names.get(p.createdById) ?? null }));
}

function socialAdapter(): ApprovalAdapter {
  return createSocialPostAdapter({
    service: socialService(),
    loadAwaiting: async (limit) => hydratePosts(await prisma.socialPost.findMany({ where: { status: "NEEDS_REVIEW" }, orderBy: { updatedAt: "asc" }, take: limit })),
    loadRequestedBy: async (userId, limit) => hydratePosts(await prisma.socialPost.findMany({ where: { createdById: userId, OR: [{ status: { in: ["NEEDS_REVIEW", "APPROVED", "SCHEDULED"] } }, { status: "DRAFT", reviewNote: { not: null } }] }, orderBy: { updatedAt: "desc" }, take: limit })),
    loadRow: async (id) => (await hydratePosts(await prisma.socialPost.findMany({ where: { id } })))[0] ?? null,
  });
}

// ---- referral statements -----------------------------------------------------------------------------------------------
async function hydrateStatements(rows: Awaited<ReturnType<typeof prisma.rewardStatement.findMany>>): Promise<StatementView[]> {
  if (!rows.length) return [];
  const [referrers, users] = await Promise.all([
    prisma.referrer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.referrerId))] } }, select: { id: true, client: { select: { clientCode: true } } } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.preparedById))] } }, select: { id: true, name: true } }),
  ]);
  const codes = new Map(referrers.map((r) => [r.id, r.client.clientCode]));
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id, referrerId: r.referrerId, period: r.period, status: r.status as StatementView["status"], totalPaise: r.totalPaise, lines: r.lines as StatementView["lines"], preparedById: r.preparedById, approvedById: r.approvedById, bankReference: r.bankReference,
    referrerLabel: codes.get(r.referrerId) ? `Referrer ${codes.get(r.referrerId)}` : null, preparedAt: r.preparedAt, approvedAt: r.approvedAt, preparerName: names.get(r.preparedById) ?? null,
  }));
}

function statementAdapter(): ApprovalAdapter {
  return createReferralStatementAdapter({
    store: prismaReferralStore, enabled: () => referralEnabled(),
    loadAwaiting: async (limit) => hydrateStatements(await prisma.rewardStatement.findMany({ where: { status: "PREPARED" }, orderBy: { preparedAt: "asc" }, take: limit })),
    loadPreparedBy: async (userId, limit) => hydrateStatements(await prisma.rewardStatement.findMany({ where: { preparedById: userId }, orderBy: { preparedAt: "desc" }, take: limit })),
    loadView: async (id) => (await hydrateStatements(await prisma.rewardStatement.findMany({ where: { id } })))[0] ?? null,
  });
}

// ---- merge suggestions -------------------------------------------------------------------------------------------------
const LIVE = { isDeleted: false, mergedIntoId: null } as const;
const mergeSelect = { id: true, status: true, score: true, reasons: true, createdAt: true, decidedAt: true, clientA: { select: { id: true, name: true, clientCode: true, assignedToId: true } }, clientB: { select: { id: true, name: true, clientCode: true, assignedToId: true } } } as const;
type MergeDb = NonNullable<Awaited<ReturnType<typeof prisma.mergeSuggestion.findUnique<{ where: { id: string }; select: typeof mergeSelect }>>>>;
function toMergeRow(actor: { id: string; role: string }, r: MergeDb): MergeRow {
  const a = { id: r.clientA.id, first: firstName(r.clientA.name), code: r.clientA.clientCode };
  const b = { id: r.clientB.id, first: firstName(r.clientB.name), code: r.clientB.clientCode };
  const who = { id: actor.id, role: actor.role as never };
  return {
    id: r.id, status: r.status, score: r.score, ...confidenceOf(r.score), reasons: r.reasons.map(reasonText), a: visibleSide(who, r.clientA, a), b: visibleSide(who, r.clientB, b),
    restricted: reviewAccess(who, [r.clientA, r.clientB]) !== "full", createdAt: r.createdAt, decidedAt: r.decidedAt,
  };
}
function mergeAdapter(): ApprovalAdapter {
  return createMergeSuggestionAdapter({
    legacy: mergeDecideDeps(), enabled: () => mergeReviewEnabled(),
    loadAwaiting: async (actor, limit) => {
      const scope = actor.role === "ADMIN" || actor.role === "MANAGER" ? {} : { OR: [{ clientA: { assignedToId: actor.id } }, { clientB: { assignedToId: actor.id } }] };
      const rows = await prisma.mergeSuggestion.findMany({ where: { status: "OPEN", clientA: LIVE, clientB: LIVE, ...scope }, orderBy: [{ score: "desc" }, { createdAt: "asc" }], take: limit, select: mergeSelect });
      return rows.map((r) => toMergeRow(actor, r));
    },
    loadRow: async (id, actor) => {
      const r = await prisma.mergeSuggestion.findUnique({ where: { id }, select: mergeSelect });
      if (!r) return null;
      const row = toMergeRow(actor, r);
      // An RM with no customer on either side gets the same answer as for a pair that does not exist.
      return actor.role === "RM" && reviewAccess({ id: actor.id, role: "RM" }, [r.clientA, r.clientB]) === "none" ? null : row;
    },
  });
}

// ---- AI pilot sign-off -------------------------------------------------------------------------------------------------
function pilotAdapter(): ApprovalAdapter {
  return createAiPilotSignoffAdapter({
    db: pilotDb,
    loadFacts: async () => {
      const [users, so] = await Promise.all([pilotDb.listPilotUsers(), pilotDb.currentSignoff()]);
      const first = users[0] ?? null;
      return { listedUsers: users.length, firstListedAt: first?.addedAt ?? null, firstListedById: first?.addedById ?? null, signoff: so && { statementVersion: so.statementVersion, acknowledgedById: so.acknowledgedById, acknowledgedAt: so.acknowledgedAt } };
    },
  });
}

// ---- native (ApprovalRequest) ------------------------------------------------------------------------------------------
const reqInclude = { requestedBy: { select: { name: true } } } as const;
const toRequestRow = (r: Awaited<ReturnType<typeof prisma.approvalRequest.findMany<{ include: typeof reqInclude }>>>[number]): RequestRow => ({
  id: r.id, actionType: r.actionType, entity: r.entity, entityId: r.entityId, status: r.status, payload: r.payload, reason: r.reason, requestedById: r.requestedById, requestedByName: r.requestedBy.name,
  requestedAt: r.requestedAt, decidedById: r.decidedById, decidedAt: r.decidedAt, decisionNote: r.decisionNote, expiresAt: r.expiresAt, appliedAt: r.appliedAt, correlationId: r.correlationId, causationId: r.causationId, autonomyLevel: r.autonomyLevel,
});
const dateIN = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

async function nativeFacts(kind: NativeKind, row: RequestRow): Promise<RequestFacts> {
  if (kind !== "payout-run") return null;
  const id = (row.payload as { payoutRunId?: string } | null)?.payoutRunId;
  if (!id) return null;
  const run = await prisma.payoutRun.findUnique({ where: { id }, select: { periodStart: true, periodEnd: true, payouts: { select: { netPayableAmount: true } } } });
  if (!run) return null;
  const total = run.payouts.reduce((t, p) => t + Number(p.netPayableAmount), 0);
  return { period: `${dateIN(run.periodStart)} to ${dateIN(run.periodEnd)}`, payouts: run.payouts.length, totalNet: `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total)}` };
}

function nativeAdapter(kind: NativeKind): ApprovalAdapter {
  return createApprovalRequestAdapter({
    kind,
    decide: (id, decision, note, actor, options) => decideApproval(id, decision, note, actor, options),
    loadAwaiting: async (actionType, limit) => (await prisma.approvalRequest.findMany({ where: { actionType, status: "PENDING" }, include: reqInclude, orderBy: { requestedAt: "asc" }, take: limit })).map(toRequestRow),
    loadRequestedBy: async (actionType, userId, limit) => (await prisma.approvalRequest.findMany({ where: { actionType, requestedById: userId }, include: reqInclude, orderBy: { requestedAt: "desc" }, take: limit })).map(toRequestRow),
    loadRow: async (id) => {
      const r = await prisma.approvalRequest.findUnique({ where: { id }, include: reqInclude });
      return r ? toRequestRow(r) : null;
    },
    loadFacts: nativeFacts,
    markExpired: async (id) => { await prisma.approvalRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "EXPIRED" } }); },
  });
}

/** Every adapter that exists today. Seam kinds (autopilot, creative, lead push) have none: see docs/approvals.md. */
export function prismaAdapters(): Partial<Record<ApprovalKind, ApprovalAdapter>> {
  const out: Partial<Record<ApprovalKind, ApprovalAdapter>> = {
    "agent-proposal": agentAdapter(), "social-post": socialAdapter(), "referral-statement": statementAdapter(), "merge-suggestion": mergeAdapter(), "ai-pilot-signoff": pilotAdapter(),
  };
  for (const kind of Object.keys(NATIVE_KINDS) as NativeKind[]) out[kind] = nativeAdapter(kind);
  return out;
}

const writeAudit = async (e: AuditEntry) => {
  await prisma.auditLog.create({ data: { userId: e.userId, entity: e.entity, entityId: e.entityId, action: e.action, newValue: e.newValue as never, reason: e.reason } });
};

export function approvalService(adapters: Partial<Record<ApprovalKind, ApprovalAdapter>> = prismaAdapters()): ApprovalService {
  return createApprovalService({
    adapters, now: () => new Date(), audit: writeAudit,
    writeThrough: (kind) => writeThroughEnabled(kind),
    mirror: (record) => writeMirror(prisma as never, record),
    consentGate: (purpose, channel) => consentGate(purpose as ConsentPurpose, channel as ConsentChannel | null),
  });
}
