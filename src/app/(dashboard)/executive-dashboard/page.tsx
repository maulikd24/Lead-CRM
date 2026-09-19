import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { LeadsActivitySection } from "../reports/leads-activity-section";
import { RmPerformanceTable } from "../reports/rm-performance-table";
import { computeSlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { getRmPerformanceRows } from "@/lib/reports/rm-performance";
import type { Prisma } from "@/generated/prisma/client";

type ExecutiveDashboardSearchParams = { laGranularity?: string; laFrom?: string; laTo?: string };

export default async function ExecutiveDashboardPage({
  searchParams,
}: {
  searchParams: Promise<ExecutiveDashboardSearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole(["ADMIN"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter: Prisma.ClientWhereInput = visibleUserIds
    ? { assignedToId: { in: visibleUserIds }, isDeleted: false }
    : { isDeleted: false };
  const now = new Date();

  const [totalLeads, activeClients, completedClients, activeClientRows, completedDurations, rmPerformance] =
    await Promise.all([
      prisma.client.count({ where: clientFilter }),
      prisma.client.count({ where: { ...clientFilter, status: "ACTIVE" } }),
      prisma.client.count({ where: { ...clientFilter, status: "COMPLETED" } }),
      prisma.client.findMany({
        where: { ...clientFilter, status: "ACTIVE" },
        select: {
          id: true,
          currentStageId: true,
          stageEnteredAt: true,
          currentStage: { select: { name: true, slaHours: true } },
        },
      }),
      prisma.client.findMany({
        where: { ...clientFilter, status: "COMPLETED", completedAt: { not: null } },
        select: { createdAt: true, completedAt: true },
      }),
      getRmPerformanceRows(clientFilter, visibleUserIds, now),
    ]);

  const exceptionsForActive = activeClientRows.length
    ? await prisma.exception.findMany({
        where: { clientId: { in: activeClientRows.map((c) => c.id) } },
        select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
      })
    : [];

  const overdueCount = activeClientRows.filter((client) => {
    const heldMs = exceptionsForActive
      .filter((e) => e.clientId === client.id && e.stageId === client.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
    const status = computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, heldMs), client.currentStage.slaHours, now);
    return status === "OVERDUE";
  }).length;

  const slaCompliance =
    activeClientRows.length > 0 ? Math.round(((activeClientRows.length - overdueCount) / activeClientRows.length) * 100) : 100;

  const avgOnboardingDays =
    completedDurations.length > 0
      ? Math.round(
          (completedDurations.reduce((sum, c) => sum + (c.completedAt!.getTime() - c.createdAt.getTime()), 0) /
            completedDurations.length /
            (1000 * 60 * 60 * 24)) *
            10,
        ) / 10
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Executive Dashboard" description="Organization-wide RM performance and lead activity." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total Leads" value={totalLeads} />
        <StatCard label="Active Onboarding" value={activeClients} />
        <StatCard label="Completed" value={completedClients} tone="success" />
        <StatCard label="SLA Compliance" value={`${slaCompliance}%`} tone={slaCompliance < 80 ? "warning" : "success"} />
        <StatCard label="Avg Onboarding Time" value={avgOnboardingDays > 0 ? `${avgOnboardingDays}d` : "—"} />
      </div>

      <LeadsActivitySection searchParams={params} clientWhere={clientFilter} />

      <Card>
        <CardHeader>
          <CardTitle>RM Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <RmPerformanceTable rows={rmPerformance} />
        </CardContent>
      </Card>
    </div>
  );
}
