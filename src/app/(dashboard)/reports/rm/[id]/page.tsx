import { notFound } from "next/navigation";
import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { computeRmPerformance } from "@/lib/reports/rm-performance";
import { LeadsActivitySection } from "../../leads-activity-section";
import { CLIENT_STATUS_VARIANT, PRIORITY_VARIANT } from "@/lib/status-badge-config";
import { formatDateTime, formatStageAge } from "@/lib/utils/format";

type ReportsSearchParams = { laGranularity?: string; laFrom?: string; laTo?: string };

export default async function RmPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ReportsSearchParams>;
}) {
  const { id } = await params;
  const laParams = await searchParams;
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);

  if (visibleUserIds && !visibleUserIds.includes(id)) notFound();

  const rm = await prisma.user.findUnique({
    where: { id, role: "RM" },
    include: { manager: { select: { name: true } } },
  });
  if (!rm) notFound();

  const now = new Date();
  const clientFilter = { assignedToId: id };

  const [activeClientRows, completedDurations, overdueTasksCount, allAssignedClients] = await Promise.all([
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
    prisma.task.count({ where: { assignedToId: id, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now } } }),
    prisma.client.findMany({
      where: { ...clientFilter, isDeleted: false },
      include: { currentStage: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const allAssignedClientIds = allAssignedClients.map((c) => c.id);

  const [exceptionsForActive, lastActivities] = await Promise.all([
    activeClientRows.length
      ? prisma.exception.findMany({
          where: { clientId: { in: activeClientRows.map((c) => c.id) } },
          select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
        })
      : Promise.resolve([]),
    allAssignedClientIds.length
      ? prisma.activity.findMany({
          where: { clientId: { in: allAssignedClientIds } },
          orderBy: [{ clientId: "asc" }, { createdAt: "desc" }],
          distinct: ["clientId"],
        })
      : Promise.resolve([]),
  ]);

  const lastActivityByClient = new Map(lastActivities.map((a) => [a.clientId, a]));

  const overdueTaskCountByRm = new Map([[id, overdueTasksCount]]);
  const [performance] = computeRmPerformance(
    [{ id: rm.id, name: rm.name, capacity: rm.capacity }],
    activeClientRows,
    completedDurations,
    overdueTaskCountByRm,
    exceptionsForActive,
    now,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={rm.name}
        description={`${rm.email} · Capacity ${rm.capacity ?? "—"} · Manager: ${rm.manager?.name ?? "None"}${rm.regions.length ? ` · Regions: ${rm.regions.join(", ")}` : ""}${rm.languages.length ? ` · Languages: ${rm.languages.join(", ")}` : ""}`}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active" value={performance.active} />
        <StatCard label="Completed" value={performance.completed} tone="success" />
        <StatCard label="Overdue Tasks" value={performance.overdueTasks} tone={performance.overdueTasks > 0 ? "destructive" : "default"} />
        <StatCard label="SLA %" value={`${performance.rmSlaPct}%`} tone={performance.rmSlaPct < 80 ? "warning" : "success"} />
        <StatCard label="Avg Onboarding Days" value={performance.rmAvgDays > 0 ? `${performance.rmAvgDays}d` : "—"} />
        <StatCard label="Capacity" value={rm.capacity ?? "—"} />
      </div>

      <LeadsActivitySection searchParams={laParams} clientWhere={clientFilter} csvExtraParams={{ rmId: id }} rmId={id} />

      <Card>
        <CardHeader>
          <CardTitle>Assigned Clients</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Stage Age</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>SLA Status</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allAssignedClients.map((client) => {
                const ageHours = stageAgeHours(client.stageEnteredAt, now);
                const slaStatus = computeSlaStatus(effectiveStageEnteredAt(client.stageEnteredAt, 0), client.currentStage.slaHours, now);
                const lastActivity = lastActivityByClient.get(client.id);
                return (
                  <TableRow key={client.id}>
                    <TableCell>
                      <Link href={`/clients/${client.id}`} className="text-primary underline-offset-2 hover:underline">
                        {client.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{client.clientCode}</span>
                    </TableCell>
                    <TableCell className="text-sm">{client.currentStage.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatStageAge(ageHours)}</TableCell>
                    <TableCell>
                      <Badge variant={PRIORITY_VARIANT[client.priority]}>{client.priority}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{slaStatus.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <Badge variant={CLIENT_STATUS_VARIANT[client.status]}>{client.status.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {lastActivity ? formatDateTime(lastActivity.createdAt) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {allAssignedClients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No clients assigned yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
