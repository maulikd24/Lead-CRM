import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CalendarClock } from "lucide-react";
import { formatTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { rowHover } from "@/components/wow/row";
import { ShowFirst } from "@/components/workspace";
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

  if (dueTodayTasks.length === 0) {
    // Nothing due: one compact row with the next step, not a tall empty card.
    return (
      <Card className={cn("py-3", className)} data-testid="schedule-empty">
        <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <CalendarClock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-heading text-sm font-medium">Today&apos;s schedule is clear</p>
              <p className="text-xs text-muted-foreground">No follow-ups due today.</p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="min-h-11" render={<Link href="/copilot" />}>
            See who to contact
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>Today&apos;s schedule</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <ShowFirst name="schedule" title="Today's schedule" noun="items" limit={2} as="div" className="gap-1" sheetClassName="gap-1" items={dueTodayTasks.map((task) => (
          <Link
            key={task.id}
            href={`/clients/${task.client.id}`}
            className={cn("flex items-center gap-3 rounded-md px-1.5 py-1.5", rowHover)}
          >
            <span className="w-12 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{formatTime(task.dueAt)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{task.title}</p>
              <p className="truncate text-xs text-muted-foreground">{task.client.name}</p>
            </div>
          </Link>
        ))} />
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
