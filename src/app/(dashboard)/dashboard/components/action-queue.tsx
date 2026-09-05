import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatStageAge } from "@/lib/utils/format";
import { computeSlaStatus, stageAgeHours } from "@/lib/stage-engine/sla-status";
import { effectiveStageEnteredAt } from "@/lib/stage-engine/held-duration";
import { BlockerBadge } from "@/components/blocker-badge";
import { ActionQueueRowActions } from "./action-queue-row-actions";
import { PRIORITY_VARIANT, SLA_VARIANT } from "@/lib/status-badge-config";
import { TableRowSkeleton } from "@/components/shared/skeletons";
import type { Prisma } from "@/generated/prisma/client";

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
        select: { clientId: true, stageId: true, reason: true, status: true, createdAt: true, resolvedAt: true },
      })
    : [];

  function heldMsForTask(task: (typeof queueTasks)[number]) {
    return exceptionsForQueue
      .filter((e) => e.clientId === task.clientId && e.stageId === task.client.currentStageId)
      .reduce((sum, e) => sum + Math.max(0, (e.resolvedAt ?? now).getTime() - e.createdAt.getTime()), 0);
  }

  function slaStatusForTask(task: (typeof queueTasks)[number]) {
    return computeSlaStatus(effectiveStageEnteredAt(task.client.stageEnteredAt, heldMsForTask(task)), task.client.currentStage.slaHours, now);
  }

  function blockerReasonForTask(task: (typeof queueTasks)[number]) {
    return exceptionsForQueue.find((e) => e.clientId === task.clientId && e.status === "OPEN")?.reason ?? null;
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
              <TableHead>Stage Age</TableHead>
              <TableHead>SLA Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queueTasks.map((task) => {
              const isOverdue = task.dueAt < now;
              const slaStatus = slaStatusForTask(task);
              const ageHours = stageAgeHours(effectiveStageEnteredAt(task.client.stageEnteredAt, heldMsForTask(task)), now);
              const blockerReason = blockerReasonForTask(task);
              return (
                <TableRow key={task.id}>
                  <TableCell className="text-sm">
                    <Link href={`/clients/${task.clientId}`} className="hover:underline">
                      {task.client.name}
                    </Link>
                    <BlockerBadge reason={blockerReason} />
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
                  <TableCell className="text-xs text-muted-foreground">{formatStageAge(ageHours)}</TableCell>
                  <TableCell>
                    <Badge variant={SLA_VARIANT[slaStatus]}>{slaStatus.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    <ActionQueueRowActions taskId={task.id} />
                  </TableCell>
                </TableRow>
              );
            })}
            {queueTasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
      <CardContent>
        <Table>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRowSkeleton key={i} columns={8} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
