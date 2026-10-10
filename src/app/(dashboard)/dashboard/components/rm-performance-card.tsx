import Link from "next/link";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgressBar } from "@/components/shared/progress-bar";
import { summariseRmPerformance } from "@/lib/reports/rm-performance-summary";
import { getRmPerformanceRows } from "@/lib/reports/rm-performance";
import { cn } from "@/lib/utils";
import { motionEnabled } from "@/components/motion/tokens";
import { LazyCountUp as CountUp } from "@/components/motion/lazy";
import { LazyAnimatedProgressBar as AnimatedProgressBar } from "@/components/motion/lazy";
import type { Prisma } from "@/generated/prisma/client";

export async function RmPerformanceCard({
  clientFilter,
  visibleUserIds,
  className,
}: {
  clientFilter: Prisma.ClientWhereInput;
  visibleUserIds: string[] | null;
  className?: string;
}) {
  const rows = await getRmPerformanceRows(clientFilter, visibleUserIds, new Date());

  const summary = summariseRmPerformance(rows);
  const animated = motionEnabled();

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>RM performance</CardTitle>
        <Link href="/reports" className="text-[11px] font-bold text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {summary.metrics.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No team members to report on yet. Figures appear here once clients are assigned.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {summary.metrics.map((metric, i) => (
              <div key={metric.key}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{metric.label}</p>
                {metric.value === null ? (
                  <>
                    <p className="font-heading text-2xl font-extrabold text-muted-foreground" aria-label="Not enough data yet">Not enough data yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">{metric.empty}</p>
                  </>
                ) : (
                  <>
                    <p className="font-heading text-2xl font-extrabold tabular-nums">
                      {animated ? <CountUp value={metric.value} format="percent" delay={i * 0.1} /> : `${metric.value}%`}
                    </p>
                    {animated ? <AnimatedProgressBar value={metric.value} delay={i * 0.1} /> : <ProgressBar value={metric.value} />}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {summary.leaders.length > 0 && (
          <div>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Busiest team members</h3>
            <ul className="divide-y divide-border text-sm">
              {summary.leaders.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/reports/rm/${l.id}`} className="min-w-0 truncate hover:underline">{l.name}</Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{l.active} active · {l.slaPct}% on time</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RmPerformanceCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
