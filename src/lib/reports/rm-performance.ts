import { prisma } from "@/lib/db/prisma";
import { computeSlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import type { Prisma } from "@/generated/prisma/client";

export type RmPerformanceRow = {
  rm: { id: string; name: string; capacity: number | null };
  active: number;
  completed: number;
  onHold: number;
  overdueTasks: number;
  rmOverdue: number;
  rmSlaPct: number;
  rmAvgDays: number;
};

/**
 * Pure computation — callers supply already-fetched, already-scoped rows; this never queries
 * Prisma itself. The team-wide Reports page calls this once with every RM (reusing its existing
 * bulk queries); the RM detail page calls it with a single RM and its own narrowly-scoped
 * queries. Either way the SLA%/avg-days formulas live in exactly one place.
 */
export function computeRmPerformance(
  rms: { id: string; name: string; capacity: number | null }[],
  activeClientRows: {
    id: string;
    assignedToId: string | null;
    currentStageId: string;
    stageEnteredAt: Date;
    currentStage: { name: string; slaHours: number };
    fundingRecord: { status: string } | null;
  }[],
  completedDurations: { assignedToId: string | null; createdAt: Date; completedAt: Date | null }[],
  overdueTaskCountByRm: Map<string, number>,
  onHoldCountByRm: Map<string | null, number>,
  exceptionsForActive: { clientId: string; stageId: string; createdAt: Date; resolvedAt: Date | null }[],
  now: Date,
): RmPerformanceRow[] {
  return rms.map((rm) => {
    const rmActiveRows = activeClientRows.filter((c) => c.assignedToId === rm.id);
    const rmCompleted = completedDurations.filter((c) => c.assignedToId === rm.id);
    const overdueTasks = overdueTaskCountByRm.get(rm.id) ?? 0;
    const onHold = onHoldCountByRm.get(rm.id) ?? 0;

    const rmOverdue = rmActiveRows.filter((client) => {
      const heldMs = exceptionsForActive
        .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
        .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
      const status = computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, heldMs), client.currentStage.slaHours, now);
      return status === "OVERDUE";
    }).length;
    const rmSlaPct = rmActiveRows.length > 0 ? Math.round(((rmActiveRows.length - rmOverdue) / rmActiveRows.length) * 100) : 100;
    const rmAvgDays =
      rmCompleted.length > 0
        ? Math.round(
            (rmCompleted.reduce((sum, c) => sum + (c.completedAt!.getTime() - c.createdAt.getTime()), 0) /
              rmCompleted.length /
              (1000 * 60 * 60 * 24)) *
              10,
          ) / 10
        : 0;
    return { rm, active: rmActiveRows.length, completed: rmCompleted.length, onHold, overdueTasks, rmOverdue, rmSlaPct, rmAvgDays };
  });
}

/**
 * Self-contained fetch + compute for callers (e.g. the Manager Dashboard) that only need the
 * per-RM performance rows themselves, not the raw client rows Reports also uses for its other
 * aggregates (SLA compliance, avg onboarding time, stage aging) — those callers keep fetching
 * those rows directly rather than going through this helper, so this doesn't introduce a second,
 * duplicate query for data Reports already has in hand.
 */
export async function getRmPerformanceRows(
  clientFilter: Prisma.ClientWhereInput,
  visibleUserIds: string[] | null,
  now: Date,
): Promise<RmPerformanceRow[]> {
  const [rms, activeClientRows, completedDurations, overdueTasksByRm, onHoldByRm] = await Promise.all([
    visibleUserIds
      ? prisma.user.findMany({ where: { id: { in: visibleUserIds }, role: "RM" }, orderBy: { name: "asc" } })
      : prisma.user.findMany({ where: { role: "RM" }, orderBy: { name: "asc" } }),
    prisma.client.findMany({
      where: { ...clientFilter, status: "ACTIVE" },
      select: {
        id: true,
        assignedToId: true,
        currentStageId: true,
        stageEnteredAt: true,
        currentStage: { select: { name: true, slaHours: true } },
        fundingRecord: { select: { status: true } },
      },
    }),
    prisma.client.findMany({
      where: { ...clientFilter, status: "COMPLETED", completedAt: { not: null } },
      select: { assignedToId: true, createdAt: true, completedAt: true },
    }),
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

  const exceptionsForActive = activeClientRows.length
    ? await prisma.exception.findMany({
        where: { clientId: { in: activeClientRows.map((c) => c.id) } },
        select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
      })
    : [];

  return computeRmPerformance(rms, activeClientRows, completedDurations, overdueTaskCountByRm, onHoldCountByRm, exceptionsForActive, now);
}
