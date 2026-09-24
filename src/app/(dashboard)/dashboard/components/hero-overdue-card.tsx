import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/shared/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Prisma } from "@/generated/prisma/client";

const SPARKLINE_DAYS = 7;

export async function HeroOverdueCard({ taskFilter, className }: { taskFilter: Prisma.TaskWhereInput; className?: string }) {
  const now = new Date();

  const overdueTasks = await prisma.task.findMany({
    where: { ...taskFilter, status: { in: ["PENDING", "OVERDUE"] }, dueAt: { lt: now }, client: { isDeleted: false } },
    select: { dueAt: true },
  });

  const dayBuckets = Array.from({ length: SPARKLINE_DAYS }, (_, i) => {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    dayStart.setDate(dayStart.getDate() - (SPARKLINE_DAYS - 1 - i));
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    return overdueTasks.filter((t) => t.dueAt >= dayStart && t.dueAt < dayEnd).length;
  });

  return (
    <Card className={cn("justify-between border-transparent bg-foreground p-5 text-background", className)}>
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-background/56">Overdue</p>
        <p className="font-heading text-5xl font-extrabold tabular-nums">{overdueTasks.length}</p>
        <p className="text-xs text-background/56">open items</p>
      </div>
      <Sparkline values={dayBuckets} />
      <Link href="/tasks" className="text-[11px] font-bold text-background hover:underline">
        View all {overdueTasks.length}
      </Link>
    </Card>
  );
}

export function HeroOverdueCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("border-transparent bg-foreground p-5", className)}>
      <Skeleton className="h-4 w-16 bg-background/20" />
      <Skeleton className="mt-2 h-10 w-20 bg-background/20" />
      <Skeleton className="mt-4 h-8 w-full bg-background/20" />
    </Card>
  );
}
