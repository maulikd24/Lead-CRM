import Link from "next/link";
import { AlertCircle } from "lucide-react";

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
    // On-theme dark card (the same near-black surface as the sidebar) with a red accent: it is the one real warning on this tab.
    <Card className={cn("relative justify-between gap-3 overflow-hidden border-sidebar-border bg-sidebar p-5 pl-6 text-sidebar-foreground max-lg:gap-2 max-lg:p-3 max-lg:pl-4", className)} data-testid="overdue-hero">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-destructive" />
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-sidebar-foreground/70">
          <AlertCircle aria-hidden className="size-3.5 text-destructive" /> Overdue
        </p>
        <p className="font-heading text-5xl font-semibold tabular-nums text-[#F2686C] max-lg:text-3xl">{overdueTasks.length}</p>
        <p className="text-xs text-sidebar-foreground/70">open items</p>
      </div>
      <div className="max-lg:hidden"><Sparkline values={dayBuckets} /></div>
      <Link href="/tasks" className="-mx-2 inline-flex min-h-11 w-fit items-center rounded-md px-2 text-xs font-semibold text-sidebar-foreground hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none">
        View all {overdueTasks.length}
      </Link>
    </Card>
  );
}

export function HeroOverdueCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("border-sidebar-border bg-sidebar p-5", className)}>
      <Skeleton className="h-4 w-16 bg-sidebar-foreground/15" />
      <Skeleton className="mt-2 h-10 w-20 bg-sidebar-foreground/15" />
      <Skeleton className="mt-4 h-8 w-full bg-sidebar-foreground/15" />
    </Card>
  );
}
