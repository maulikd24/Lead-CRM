import { computeSlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";

export type RmPerformanceRow = {
  rm: { id: string; name: string; capacity: number | null };
  active: number;
  completed: number;
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
  exceptionsForActive: { clientId: string; stageId: string; createdAt: Date; resolvedAt: Date | null }[],
  now: Date,
): RmPerformanceRow[] {
  return rms.map((rm) => {
    const rmActiveRows = activeClientRows.filter((c) => c.assignedToId === rm.id);
    const rmCompleted = completedDurations.filter((c) => c.assignedToId === rm.id);
    const overdueTasks = overdueTaskCountByRm.get(rm.id) ?? 0;

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
    return { rm, active: rmActiveRows.length, completed: rmCompleted.length, overdueTasks, rmOverdue, rmSlaPct, rmAvgDays };
  });
}
