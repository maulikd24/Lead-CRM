import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { OverdueFollowupsRowActions } from "./overdue-followups-row-actions";
import type { Prisma } from "@/generated/prisma/client";

export async function OverdueFollowupsCard({ taskFilter, className }: { taskFilter: Prisma.TaskWhereInput; className?: string }) {
  const now = new Date();

  const overdueTasks = await prisma.task.findMany({
    where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now }, client: { isDeleted: false } },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { dueAt: "asc" },
    take: 8,
  });

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Service levels</p>
          <CardTitle>Overdue follow-ups</CardTitle>
        </div>
        <Link href="/tasks" className="text-[11px] font-bold text-primary hover:underline">
          Review queue
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {overdueTasks.length === 0 && (
          <EmptyState icon={CheckCircle2} title="Nothing overdue" description="Every follow-up is on track." />
        )}
        {overdueTasks.map((task) => {
          const daysOverdue = Math.max(0, Math.floor((now.getTime() - task.dueAt.getTime()) / 86400000));
          return (
            <div key={task.id} className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1.5 hover:bg-muted">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{task.title}</p>
                <p className="truncate text-xs text-muted-foreground">{task.client.name}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground">{daysOverdue}d</span>
                <OverdueFollowupsRowActions taskId={task.id} clientId={task.client.id} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function OverdueFollowupsCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-1 h-5 w-40" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
