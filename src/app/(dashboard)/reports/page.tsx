import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StageFunnelChart } from "./stage-funnel-chart";

export default async function ReportsPage() {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};

  const [stages, clientsByStage, rms, totalClients, completedClients] = await Promise.all([
    prisma.stage.findMany({ orderBy: { sequence: "asc" } }),
    prisma.client.groupBy({
      by: ["currentStageId"],
      where: clientFilter,
      _count: { _all: true },
    }),
    visibleUserIds
      ? prisma.user.findMany({ where: { id: { in: visibleUserIds }, role: "RM" }, orderBy: { name: "asc" } })
      : prisma.user.findMany({ where: { role: "RM" }, orderBy: { name: "asc" } }),
    prisma.client.count({ where: clientFilter }),
    prisma.client.count({ where: { ...clientFilter, status: "COMPLETED" } }),
  ]);

  const countByStageId = new Map(clientsByStage.map((row) => [row.currentStageId, row._count._all]));
  const funnelData = stages.map((stage) => ({
    stage: stage.name,
    count: countByStageId.get(stage.id) ?? 0,
  }));

  const rmPerformance = [];
  for (const rm of rms) {
    const active = await prisma.client.count({ where: { assignedToId: rm.id, status: "ACTIVE" } });
    const completed = await prisma.client.count({ where: { assignedToId: rm.id, status: "COMPLETED" } });
    const overdue = await prisma.task.count({ where: { assignedToId: rm.id, status: "PENDING", dueAt: { lt: new Date() } } });
    rmPerformance.push({ rm, active, completed, overdue });
  }

  const completionRate = totalClients > 0 ? Math.round((completedClients / totalClients) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card size="sm">
          <CardContent className="flex flex-col gap-1 px-4">
            <p className="text-xs text-muted-foreground">Total Clients</p>
            <p className="font-heading text-2xl font-semibold">{totalClients}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex flex-col gap-1 px-4">
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="font-heading text-2xl font-semibold">{completedClients}</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex flex-col gap-1 px-4">
            <p className="text-xs text-muted-foreground">Completion Rate</p>
            <p className="font-heading text-2xl font-semibold">{completionRate}%</p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardContent className="flex flex-col gap-1 px-4">
            <p className="text-xs text-muted-foreground">RMs Tracked</p>
            <p className="font-heading text-2xl font-semibold">{rms.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stage Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <StageFunnelChart data={funnelData} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>RM Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RM</TableHead>
                <TableHead>Active Clients</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Overdue Tasks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rmPerformance.map(({ rm, active, completed, overdue }) => (
                <TableRow key={rm.id}>
                  <TableCell className="font-medium">{rm.name}</TableCell>
                  <TableCell>{active}</TableCell>
                  <TableCell>{completed}</TableCell>
                  <TableCell className={overdue > 0 ? "text-destructive" : ""}>{overdue}</TableCell>
                </TableRow>
              ))}
              {rmPerformance.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No RMs to report on yet.
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
