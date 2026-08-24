import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";
import { computeSlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "default" | "destructive" | "warning" }) {
  const toneClass =
    tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-amber-600 dark:text-amber-400" : "text-foreground";
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1 px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`font-heading text-2xl font-semibold ${toneClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  HIGH: "destructive",
  MEDIUM: "secondary",
  LOW: "outline",
};

const SLA_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ON_TRACK: "default",
  DUE_SOON: "secondary",
  OVERDUE: "destructive",
  NOT_APPLICABLE: "outline",
};

export default async function DashboardPage() {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const clientFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};
  const taskFilter = visibleUserIds ? { assignedToId: { in: visibleUserIds } } : {};
  const today = startOfToday();
  const now = new Date();

  const [activeClients, newToday, completedClients, dueToday, overdueTasks] = await Promise.all([
    prisma.client.count({ where: { ...clientFilter, status: "ACTIVE" } }),
    prisma.client.count({ where: { ...clientFilter, createdAt: { gte: today } } }),
    prisma.client.count({ where: { ...clientFilter, status: "COMPLETED" } }),
    prisma.task.count({ where: { ...taskFilter, status: "PENDING", dueAt: { gte: today, lt: new Date(today.getTime() + 86400000) } } }),
    prisma.task.count({ where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now } } }),
  ]);

  const [kycPending, fundingPending, dealerPending, queueTasks] = await Promise.all([
    prisma.kycRecord.count({ where: { status: "PENDING", client: clientFilter } }),
    prisma.fundingRecord.count({ where: { status: "PENDING", client: clientFilter } }),
    prisma.dealerIntroduction.count({ where: { status: "PENDING", client: clientFilter } }),
    prisma.task.findMany({
      where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] } },
      include: { client: { include: { currentStage: true } } },
      orderBy: { dueAt: "asc" },
      take: 15,
    }),
  ]);

  const exceptionsForQueue = queueTasks.length
    ? await prisma.exception.findMany({
        where: { clientId: { in: queueTasks.map((t) => t.clientId) } },
        select: { clientId: true, stageId: true, createdAt: true, resolvedAt: true },
      })
    : [];

  function slaStatusForTask(task: (typeof queueTasks)[number]) {
    const heldMs = exceptionsForQueue
      .filter((e) => e.clientId === task.clientId && e.stageId === task.client.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
    return computeSlaStatus(effectiveStageEnteredAt(task.client.stageEnteredAt, heldMs), task.client.currentStage.slaHours, now);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Active Clients" value={activeClients} />
        <Kpi label="New Today" value={newToday} />
        <Kpi label="Due Today" value={dueToday} tone="warning" />
        <Kpi label="Overdue" value={overdueTasks} tone="destructive" />
        <Kpi label="KYC Pending" value={kycPending} />
        <Kpi label="Funding Pending" value={fundingPending} />
        <Kpi label="Dealer Intro Pending" value={dealerPending} />
        <Kpi label="Completed" value={completedClients} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My Action Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Current Stage</TableHead>
                <TableHead>Required Action</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>SLA Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queueTasks.map((task) => {
                const isOverdue = task.dueAt < now;
                const slaStatus = slaStatusForTask(task);
                return (
                  <TableRow key={task.id}>
                    <TableCell className="text-sm">
                      <Link href={`/clients/${task.clientId}`} className="hover:underline">
                        {task.client.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{task.client.currentStage.name}</TableCell>
                    <TableCell>{task.title}</TableCell>
                    <TableCell className="text-sm">
                      <span className={isOverdue ? "text-destructive" : "text-muted-foreground"}>
                        {formatDateTime(task.dueAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={PRIORITY_VARIANT[task.client.priority]}>{task.client.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={SLA_VARIANT[slaStatus]}>{slaStatus.replace(/_/g, " ")}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {queueTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nothing pending — you&apos;re all caught up.
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
