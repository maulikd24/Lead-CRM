// Reads for the shadow review screens. Every function takes the viewer and the same visibility the client page uses; a manager sees
// their team's customers (and unassigned leads), an admin sees everyone, nobody else sees anything here.
import { basePrisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { canSeeDecision, type Viewer } from "./access";
import { toDecisionView, type DecisionView } from "./view";

const SEVERITY_RANK: Record<string, number> = { material: 0, minor: 1, info: 2 };

export type ReviewRow = {
  decisionId: string;
  clientId: string;
  clientName: string;
  clientCode: string;
  rmName: string | null;
  createdAt: string;
  result: string;
  abstainReason: string | null;
  action: string;
  programme: string;
  topic: string | null;
  owner: string;
  priority: string;
  priorityScore: number;
  status: string;
  disagreement: { kind: string; severity: string; summary: string } | null;
};

function scopeWhere(viewer: Viewer, visibleUserIds: string[] | null): Prisma.DecisionRecordWhereInput {
  const client: Prisma.ClientWhereInput = { isDeleted: false, mergedIntoId: null };
  if (viewer.role === "ADMIN" && visibleUserIds === null) return { client };
  if (viewer.role === "MANAGER") return { client: { ...client, OR: [{ assignedToId: { in: visibleUserIds ?? [] } }, { assignedToId: null }] } };
  return { id: "__none__" };
}

export async function listLatestDecisions(viewer: Viewer, visibleUserIds: string[] | null, opts: { result?: string; take?: number } = {}): Promise<ReviewRow[]> {
  if (viewer.role !== "ADMIN" && viewer.role !== "MANAGER") return [];
  const rows = await basePrisma.decisionRecord.findMany({
    where: { ...scopeWhere(viewer, visibleUserIds), ...(opts.result ? { result: opts.result } : {}) },
    distinct: ["clientId"],
    orderBy: [{ clientId: "asc" }, { createdAt: "desc" }],
    include: { client: { select: { name: true, clientCode: true, assignedTo: { select: { name: true } } } }, disagreement: { select: { kind: true, severity: true, summary: true } } },
    take: 1000,
  });
  return rows
    .map((r): ReviewRow => ({ decisionId: r.id, clientId: r.clientId, clientName: r.client.name, clientCode: r.client.clientCode, rmName: r.client.assignedTo?.name ?? null, createdAt: r.createdAt.toISOString(), result: r.result, abstainReason: r.abstainReason, action: r.action, programme: r.programme, topic: r.topic, owner: r.owner, priority: r.priority, priorityScore: r.priorityScore, status: r.status, disagreement: r.disagreement }))
    .sort((a, b) => (SEVERITY_RANK[a.disagreement?.severity ?? ""] ?? 3) - (SEVERITY_RANK[b.disagreement?.severity ?? ""] ?? 3) || b.priorityScore - a.priorityScore || a.clientCode.localeCompare(b.clientCode))
    .slice(0, opts.take ?? 100);
}

export async function listDisagreements(viewer: Viewer, visibleUserIds: string[] | null, take = 100): Promise<ReviewRow[]> {
  const all = await listLatestDecisions(viewer, visibleUserIds, { take: 1000 });
  return all.filter((r) => r.disagreement).slice(0, take);
}

export async function loadDecisionViewFor(viewer: Viewer, visibleUserIds: string[] | null, decisionId: string, env: Record<string, string | undefined> = process.env): Promise<{ view: DecisionView; clientName: string; clientCode: string; canAct: boolean } | null> {
  const row = await basePrisma.decisionRecord.findUnique({
    where: { id: decisionId },
    include: { client: { select: { name: true, clientCode: true, assignedToId: true, mergedIntoId: true, isDeleted: true } }, feedback: { orderBy: { createdAt: "asc" }, select: { kind: true, reason: true, createdAt: true, userId: true } }, outcomes: { orderBy: { occurredAt: "asc" }, select: { kind: true, daysAfter: true, detail: true } }, disagreement: { select: { kind: true, severity: true, summary: true } } },
  });
  if (!row || row.client.mergedIntoId || row.client.isDeleted || !canSeeDecision(viewer, visibleUserIds, row.client, env)) return null;
  const view = toDecisionView(row);
  return { view, clientName: row.client.name, clientCode: row.client.clientCode, canAct: view.status === "OPEN" || view.status === "SNOOZED" };
}

/** Latest decision for one customer, with the same access rule. */
export async function loadLatestDecisionFor(viewer: Viewer, visibleUserIds: string[] | null, clientId: string, env: Record<string, string | undefined> = process.env) {
  const row = await basePrisma.decisionRecord.findFirst({ where: { clientId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return row ? loadDecisionViewFor(viewer, visibleUserIds, row.id, env) : null;
}

/** Which of these customers have a decision (for a "Why?" link on a list). */
export async function customersWithDecision(clientIds: string[]): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const rows = await basePrisma.decisionRecord.findMany({ where: { clientId: { in: clientIds } }, distinct: ["clientId"], select: { clientId: true } });
  return new Set(rows.map((r) => r.clientId));
}

export async function disagreementSummary(since: Date): Promise<{ byKind: Record<string, number>; bySeverity: Record<string, number>; total: number }> {
  const rows = await basePrisma.decisionDisagreement.groupBy({ by: ["kind", "severity"], where: { createdAt: { gte: since } }, _count: { _all: true } });
  const byKind: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + r._count._all;
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + r._count._all;
    total += r._count._all;
  }
  return { byKind, bySeverity, total };
}
