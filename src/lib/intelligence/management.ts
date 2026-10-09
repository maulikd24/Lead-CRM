import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { SEGMENTS, type SegmentKey } from "./constants";

const DAY = 24 * 60 * 60 * 1000;

/** Which customers a manager/admin may look at: their own team's (and unassigned leads, for Managers), or everyone. */
export function managementScope(visibleUserIds: string[] | null, includeUnassigned: boolean): Prisma.ClientWhereInput {
  return {
    isDeleted: false,
    mergedIntoId: null,
    ...(visibleUserIds ? { OR: [{ assignedToId: { in: visibleUserIds } }, ...(includeUnassigned ? [{ assignedToId: null }] : [])] } : {}),
  };
}

const FUNDED: Prisma.ClientWhereInput = { OR: [{ fundingRecord: { status: { in: ["PARTIALLY_FUNDED", "FULLY_FUNDED"] } } }, { payments: { some: { paymentType: "FUNDS_IN", status: "SUCCESS" } } }] };
const ACTIVATED: Prisma.ClientWhereInput = { tradingAccounts: { some: { transactions: { some: {} } } } };
const KYC_DONE: Prisma.ClientWhereInput = { kycRecord: { status: "APPROVED" } };

export type FunnelRow = { label: string; leads: number; kyc: number; funded: number; activated: number };

export async function getFunnelTotals(scope: Prisma.ClientWhereInput) {
  const base: Prisma.ClientWhereInput = { AND: [scope] };
  const [leads, kyc, funded, activated] = await Promise.all([
    prisma.client.count({ where: base }),
    prisma.client.count({ where: { AND: [scope, KYC_DONE] } }),
    prisma.client.count({ where: { AND: [scope, FUNDED] } }),
    prisma.client.count({ where: { AND: [scope, ACTIVATED] } }),
  ]);
  return { leads, kyc, funded, activated };
}

export async function getFunnel(scope: Prisma.ClientWhereInput) {
  const totals = await getFunnelTotals(scope);

  const sources = await prisma.client.groupBy({ by: ["leadSource"], where: scope, _count: { _all: true } });
  const bySource: FunnelRow[] = await Promise.all(
    sources
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 12)
      .map(async (row) => {
        const where: Prisma.ClientWhereInput = { AND: [scope, { leadSource: row.leadSource }] };
        const [k, f, a] = await Promise.all([
          prisma.client.count({ where: { AND: [where, KYC_DONE] } }),
          prisma.client.count({ where: { AND: [where, FUNDED] } }),
          prisma.client.count({ where: { AND: [where, ACTIVATED] } }),
        ]);
        return { label: row.leadSource ?? "Unknown", leads: row._count._all, kyc: k, funded: f, activated: a };
      }),
  );
  return { totals, bySource };
}

export async function getLifecycleCounts(scope: Prisma.ClientWhereInput) {
  const rows = await prisma.customerIntelligence.groupBy({ by: ["lifecycleStage"], where: { client: scope }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.lifecycleStage, r._count._all])) as Record<string, number>;
}

export async function getSegmentCounts(scope: Prisma.ClientWhereInput) {
  const rows = await prisma.segmentMembership.groupBy({ by: ["segment"], where: { exitedAt: null, client: scope }, _count: { _all: true } });
  const counts = Object.fromEntries(rows.map((r) => [r.segment, r._count._all]));
  return (Object.keys(SEGMENTS) as SegmentKey[]).map((key) => ({ key, label: SEGMENTS[key], count: counts[key] ?? 0 }));
}

export async function getNbaCounts(scope: Prisma.ClientWhereInput) {
  const rows = await prisma.customerIntelligence.groupBy({ by: ["nbaProgramme"], where: { client: scope, nbaPriority: { in: ["High", "Medium"] } }, _count: { _all: true } });
  return rows.map((r) => ({ programme: r.nbaProgramme, count: r._count._all })).sort((a, b) => b.count - a.count);
}

export type CustomerRow = { id: string; name: string; code: string; rm: string | null; lifecycle: string; programme: string; action: string; topic: string | null; priority: string; timing: string; reason: string };

export async function listCustomers(scope: Prisma.ClientWhereInput, where: Prisma.CustomerIntelligenceWhereInput, limit = 25): Promise<{ total: number; rows: CustomerRow[] }> {
  const filter: Prisma.CustomerIntelligenceWhereInput = { ...where, client: { AND: [scope, ...(where.client ? [where.client as Prisma.ClientWhereInput] : [])] } };
  const [total, rows] = await Promise.all([
    prisma.customerIntelligence.count({ where: filter }),
    prisma.customerIntelligence.findMany({ where: filter, orderBy: [{ priorityScore: "desc" }], take: limit, include: { client: { select: { id: true, name: true, clientCode: true, assignedTo: { select: { name: true } } } } } }),
  ]);
  return {
    total,
    rows: rows.map((r) => ({ id: r.client.id, name: r.client.name, code: r.client.clientCode, rm: r.client.assignedTo?.name ?? null, lifecycle: r.lifecycleStage, programme: r.nbaProgramme, action: r.nbaAction, topic: r.nbaTopic, priority: r.nbaPriority, timing: r.nbaTiming, reason: r.nbaReason })),
  };
}

export async function getTeamFollowups(scope: Prisma.ClientWhereInput) {
  const open = await prisma.task.groupBy({ by: ["assignedToId", "status"], where: { status: { in: ["PENDING", "OVERDUE"] }, client: scope }, _count: { _all: true } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(open.map((o) => o.assignedToId))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  const byRm = new Map<string, { rm: string; open: number; overdue: number }>();
  for (const row of open) {
    const entry = byRm.get(row.assignedToId) ?? { rm: name.get(row.assignedToId) ?? "Unknown", open: 0, overdue: 0 };
    entry.open += row._count._all;
    if (row.status === "OVERDUE") entry.overdue += row._count._all;
    byRm.set(row.assignedToId, entry);
  }
  const unassigned = await prisma.client.count({ where: { AND: [scope, { assignedToId: null, status: "ACTIVE" }] } });
  return { rms: [...byRm.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open), unassigned };
}

export async function getQuality(scope: Prisma.ClientWhereInput) {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * DAY);
  const [grouped, overdueCommitments, auditFailures, recent] = await Promise.all([
    prisma.conversationInsight.groupBy({ by: ["kind"], where: { status: "OPEN", kind: { in: ["COMPLAINT", "COMPLIANCE_CONCERN", "INCORRECT_INFO", "MISSED_OPPORTUNITY"] }, client: scope }, _count: { _all: true } }),
    prisma.conversationInsight.count({ where: { kind: "COMMITMENT", status: "OPEN", dueAt: { lt: now }, client: scope } }),
    prisma.conversationReview.count({ where: { status: "ANALYZED", qualityScore: { lt: 50 }, analyzedAt: { gte: since }, client: scope } }),
    prisma.conversationInsight.findMany({
      where: { status: "OPEN", kind: { in: ["COMPLAINT", "COMPLIANCE_CONCERN", "INCORRECT_INFO"] }, client: scope },
      orderBy: { occurredAt: "desc" },
      take: 8,
      include: { client: { select: { id: true, name: true, assignedTo: { select: { name: true } } } } },
    }),
  ]);
  const count = (kind: string) => grouped.find((g) => g.kind === kind)?._count._all ?? 0;
  return {
    complaints: count("COMPLAINT"),
    complianceFlags: count("COMPLIANCE_CONCERN") + count("INCORRECT_INFO"),
    missedOpportunities: count("MISSED_OPPORTUNITY"),
    overdueCommitments,
    auditFailures,
    recent: recent.map((r) => ({ id: r.id, clientId: r.client.id, client: r.client.name, rm: r.client.assignedTo?.name ?? null, kind: r.kind, text: r.text, dateIso: r.occurredAt.toISOString() })),
  };
}

export async function getTopObjections(scope: Prisma.ClientWhereInput, assetClass?: string) {
  const since = new Date(Date.now() - 90 * DAY);
  const rows = await prisma.conversationInsight.findMany({ where: { kind: "OBJECTION", occurredAt: { gte: since }, ...(assetClass ? { assetClass } : {}), client: scope }, orderBy: { occurredAt: "desc" }, take: 80, select: { text: true, assetClass: true } });
  return rows;
}

export async function getLostOpportunities(scope: Prisma.ClientWhereInput) {
  const since = new Date(Date.now() - 90 * DAY);
  const rows = await prisma.opportunity.findMany({ where: { stage: "LOST_DEFERRED", updatedAt: { gte: since }, client: scope }, orderBy: { updatedAt: "desc" }, take: 10, include: { client: { select: { id: true, name: true } } } });
  return rows.map((r) => ({ id: r.id, clientId: r.client.id, client: r.client.name, product: r.product, value: Number(r.estimatedValue), reason: r.lostReason }));
}
