import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { CalendarClock } from "lucide-react";
import { formatTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function TodaysScheduleCard({ taskFilter, className }: { taskFilter: Prisma.TaskWhereInput; className?: string }) {
  const today = startOfToday();
  const tomorrow = new Date(today.getTime() + 86400000);

  const dueTodayTasks = await prisma.task.findMany({
    where: { ...taskFilter, status: "PENDING", dueAt: { gte: today, lt: tomorrow }, client: { isDeleted: false } },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { dueAt: "asc" },
    take: 8,
  });

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>Today&apos;s schedule</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {dueTodayTasks.length === 0 && (
          <EmptyState icon={CalendarClock} title="Nothing scheduled" description="No follow-ups due today." />
        )}
        {dueTodayTasks.map((task) => (
          <Link
            key={task.id}
            href={`/clients/${task.client.id}`}
            className="flex items-center gap-3 rounded-md px-1.5 py-1.5 hover:bg-muted"
          >
            <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{formatTime(task.dueAt)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{task.title}</p>
              <p className="truncate text-xs text-muted-foreground">{task.client.name}</p>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export function TodaysScheduleCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
