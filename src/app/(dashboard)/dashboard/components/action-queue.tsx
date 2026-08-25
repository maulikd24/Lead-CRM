import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils/format";
import { computeSlaStatus } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import type { Prisma } from "@/generated/prisma/client";

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

export async function ActionQueue({ taskFilter }: { taskFilter: Prisma.TaskWhereInput }) {
  const now = new Date();

  const queueTasks = await prisma.task.findMany({
    where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] } },
    include: { client: { include: { currentStage: true } } },
    orderBy: { dueAt: "asc" },
    take: 15,
  });

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
  );
}

export function ActionQueueSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My Action Queue</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-full animate-pulse rounded-md bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}
