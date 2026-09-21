import { prisma } from "@/lib/db/prisma";
import { computeSlaStatus, isReferralLeadSource } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { getStageDurations, type StageDuration } from "@/lib/reports/stage-durations";
import { computeStageAging, type StageAgingRow, type SlaBreachRow } from "@/lib/reports/stage-aging";
import { computeRmPerformance, type RmPerformanceRow } from "@/lib/reports/rm-performance";
import type { Prisma } from "@/generated/prisma/client";

export type ReportsPageData = {
  totalLeads: number;
  activeClients: number;
  completedClients: number;
  notProceedingClients: number;
  onHoldClients: number;
  overdueCount: number;
  slaCompliance: number;
  avgOnboardingDays: number;
  funnelData: { stage: string; stageId: string; count: number }[];
  conversionData: { stage: string; reached: number; pct: number }[];
  stageDurations: StageDuration[];
  lostReasonGroups: { reason: string | null; count: number }[];
  sourcePerformance: { source: string; total: number; completed: number }[];
  rmPerformance: RmPerformanceRow[];
  aging: StageAgingRow[];
  slaByStage: SlaBreachRow[];
  slaByRm: SlaBreachRow[];
};

/**
 * Extracted from reports/page.tsx verbatim (same queries, same formulas) so the PDF summary export
 * can't drift from what the page itself shows — one computation, two consumers.
 */
export async function getReportsPageData(
  clientFilter: Prisma.ClientWhereInput,
  visibleUserIds: string[] | null,
  now: Date,
): Promise<ReportsPageData> {
  const [
    stages,
    clientsByStage,
    rms,
    totalLeads,
    activeClients,
    completedClients,
    notProceedingClients,
    onHoldClients,
    activeClientRows,
    completedDurations,
    stageHistoryRows,
    lostReasonRows,
    sourceRows,
    sourceCompletedRows,
    overdueTasksByRm,
    onHoldByRm,
  ] = await Promise.all([
    prisma.stage.findMany({ where: { isActive: true }, orderBy: { sequence: "asc" } }),
    prisma.client.groupBy({ by: ["currentStageId"], where: clientFilter, _count: { _all: true } }),
    visibleUserIds
      ? prisma.user.findMany({ where: { id: { in: visibleUserIds }, role: "RM" }, orderBy: { name: "asc" } })
      : prisma.user.findMany({ where: { role: "RM" }, orderBy: { name: "asc" } }),
    prisma.client.count({ where: clientFilter }),
    prisma.client.count({ where: { ...clientFilter, status: "ACTIVE" } }),
    prisma.client.count({ where: { ...clientFilter, status: "COMPLETED" } }),
    prisma.client.count({ where: { ...clientFilter, status: "NOT_PROCEEDING" } }),
    prisma.client.count({ where: { ...clientFilter, status: "ON_HOLD" } }),
    prisma.client.findMany({
      where: { ...clientFilter, status: "ACTIVE" },
      select: {
        id: true,
        assignedToId: true,
        currentStageId: true,
        stageEnteredAt: true,
        currentStage: { select: { name: true, slaHours: true } },
        fundingRecord: { select: { status: true } },
        leadSource: true,
      },
    }),
    prisma.client.findMany({
      where: { ...clientFilter, status: "COMPLETED", completedAt: { not: null } },
      select: { assignedToId: true, createdAt: true, completedAt: true },
    }),
    prisma.stageHistory.findMany({ where: { client: clientFilter }, select: { toStageId: true, clientId: true } }),
    prisma.client.findMany({ where: { ...clientFilter, status: "NOT_PROCEEDING" }, select: { id: true } }),
    prisma.client.groupBy({ by: ["leadSource"], where: clientFilter, _count: { _all: true } }),
    prisma.client.groupBy({ by: ["leadSource"], where: { ...clientFilter, status: "COMPLETED" }, _count: { _all: true } }),
    prisma.task.groupBy({
      by: ["assignedToId"],
      where: {
        ...(visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {}),
        status: { in: ["PENDING", "OVERDUE"] },
        dueAt: { lt: now },
        client: { isDeleted: false },
      },
      _count: { _all: true },
    }),
    prisma.client.groupBy({ by: ["assignedToId"], where: { ...clientFilter, status: "ON_HOLD" }, _count: { _all: true } }),
  ]);

  const overdueTaskCountByRm = new Map(overdueTasksByRm.map((row) => [row.assignedToId, row._count._all]));
  const onHoldCountByRm = new Map(onHoldByRm.map((row) => [row.assignedToId, row._count._all]));

  const [exceptionsForActive, stageDurations] = await Promise.all([
    activeClientRows.length
      ? prisma.exception.findMany({
          where: { clientId: { in: activeClientRows.map((c) => c.id) } },
          select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
        })
      : Promise.resolve([]),
    getStageDurations(clientFilter, stages),
  ]);

  // Referral clients are SLA-exempt (mostly offline, stakeholder-sourced) — excluded from both the
  // numerator and denominator here so they don't artificially inflate SLA compliance %.
  const slaTrackedRows = activeClientRows.filter((client) => !isReferralLeadSource(client.leadSource));

  const overdueCount = slaTrackedRows.filter((client) => {
    const heldMs = exceptionsForActive
      .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
    const status = computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, heldMs), client.currentStage.slaHours, now);
    return status === "OVERDUE";
  }).length;

  const slaCompliance = slaTrackedRows.length > 0 ? Math.round(((slaTrackedRows.length - overdueCount) / slaTrackedRows.length) * 100) : 100;

  const avgOnboardingDays =
    completedDurations.length > 0
      ? Math.round(
          (completedDurations.reduce((sum, c) => sum + (c.completedAt!.getTime() - c.createdAt.getTime()), 0) /
            completedDurations.length /
            (1000 * 60 * 60 * 24)) *
            10,
        ) / 10
      : 0;

  const countByStageId = new Map(clientsByStage.map((row) => [row.currentStageId, row._count._all]));
  const funnelData = stages.map((stage) => ({ stage: stage.name, stageId: stage.id, count: countByStageId.get(stage.id) ?? 0 }));
  if (funnelData.length > 0) {
    funnelData.push({ stage: "Lost", stageId: "__LOST__", count: notProceedingClients });
  }

  const reachedByStage = new Map<string, Set<string>>();
  for (const row of stageHistoryRows) {
    const set = reachedByStage.get(row.toStageId) ?? new Set<string>();
    set.add(row.clientId);
    reachedByStage.set(row.toStageId, set);
  }
  const stage1ReachedCount = stages[0] ? (reachedByStage.get(stages[0].id)?.size ?? 0) : 0;
  const conversionData = stages.map((stage) => {
    const reached = reachedByStage.get(stage.id)?.size ?? 0;
    return {
      stage: stage.name,
      reached,
      pct: stage1ReachedCount > 0 ? Math.round((reached / stage1ReachedCount) * 100) : 0,
    };
  });

  const lostClientIds = lostReasonRows.map((c) => c.id);
  const lostReasonGroupsRaw = lostClientIds.length
    ? await prisma.auditLog.groupBy({
        by: ["reason"],
        where: { entity: "Client", action: "marked_not_proceeding", entityId: { in: lostClientIds } },
        _count: { _all: true },
      })
    : [];
  const lostReasonGroups = lostReasonGroupsRaw.map((r) => ({ reason: r.reason, count: r._count._all }));

  const completedBySource = new Map(sourceCompletedRows.map((r) => [r.leadSource, r._count._all]));
  const sourcePerformance = sourceRows
    .map((r) => ({
      source: r.leadSource ?? "Unknown",
      total: r._count._all,
      completed: completedBySource.get(r.leadSource) ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  const rmPerformance = computeRmPerformance(rms, activeClientRows, completedDurations, overdueTaskCountByRm, onHoldCountByRm, exceptionsForActive, now);

  const { aging, slaByStage, slaByRm } = computeStageAging(activeClientRows, exceptionsForActive, stages, rms, now);

  return {
    totalLeads,
    activeClients,
    completedClients,
    notProceedingClients,
    onHoldClients,
    overdueCount,
    slaCompliance,
    avgOnboardingDays,
    funnelData,
    conversionData,
    stageDurations,
    lostReasonGroups,
    sourcePerformance,
    rmPerformance,
    aging,
    slaByStage,
    slaByRm,
  };
}
