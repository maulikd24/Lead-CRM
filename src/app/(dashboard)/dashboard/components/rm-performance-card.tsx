import Link from "next/link";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProgressBar } from "@/components/shared/progress-bar";
import { getRmPerformanceRows } from "@/lib/reports/rm-performance";
import { cn } from "@/lib/utils";
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

  const slaCompliance = rows.length ? rows.reduce((sum, r) => sum + r.rmSlaPct, 0) / rows.length : 0;
  const capacityRows = rows.filter((r) => r.rm.capacity != null && r.rm.capacity > 0);
  const capacityUtilization = capacityRows.length
    ? capacityRows.reduce((sum, r) => sum + Math.min(100, (r.active / (r.rm.capacity as number)) * 100), 0) / capacityRows.length
    : null;
  const totalCompleted = rows.reduce((sum, r) => sum + r.completed, 0);
  const totalActive = rows.reduce((sum, r) => sum + r.active, 0);
  const completionRate = totalCompleted + totalActive > 0 ? (totalCompleted / (totalCompleted + totalActive)) * 100 : 0;

  const metrics = [
    { label: "SLA Compliance", value: Math.round(slaCompliance) },
    ...(capacityUtilization != null ? [{ label: "Capacity Utilization", value: Math.round(capacityUtilization) }] : []),
    { label: "Completion Rate", value: Math.round(completionRate) },
  ];

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>RM performance</CardTitle>
        <Link href="/reports" className="text-[11px] font-bold text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{metric.label}</p>
            <p className="font-heading text-2xl font-extrabold tabular-nums">{metric.value}%</p>
            <ProgressBar value={metric.value} />
          </div>
        ))}
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
