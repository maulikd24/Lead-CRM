import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";

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
    prisma.task.count({ where: { ...taskFilter, status: "PENDING", dueAt: { lt: now } } }),
  ]);

  const [kycPending, fundingPending, dealerPending, queueTasks] = await Promise.all([
    prisma.kycRecord.count({ where: { status: "PENDING", client: clientFilter } }),
    prisma.fundingRecord.count({ where: { status: "PENDING", client: clientFilter } }),
    prisma.dealerIntroduction.count({ where: { status: "PENDING", client: clientFilter } }),
    prisma.task.findMany({
      where: { ...taskFilter, status: "PENDING" },
      include: { client: true },
      orderBy: { dueAt: "asc" },
      take: 15,
    }),
  ]);

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
                <TableHead>Task</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queueTasks.map((task) => {
                const isOverdue = task.dueAt < now;
                return (
                  <TableRow key={task.id}>
                    <TableCell>{task.title}</TableCell>
                    <TableCell className="text-sm">
                      <Link href={`/clients/${task.clientId}`} className="hover:underline">
                        {task.client.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDateTime(task.dueAt)}</TableCell>
                    <TableCell>
                      <Badge variant={isOverdue ? "destructive" : "outline"}>{isOverdue ? "Overdue" : "Pending"}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {queueTasks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
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
