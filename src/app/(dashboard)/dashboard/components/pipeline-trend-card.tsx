import { prisma } from "@/lib/db/prisma";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { computeOpportunityPipeline } from "@/lib/opportunity-engine/pipeline";
import { formatTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { PipelineTrendChart, type PipelineTrendDatum } from "./pipeline-trend-chart";
import type { Prisma, OpportunityStage } from "@/generated/prisma/client";

const OPEN_STAGES: OpportunityStage[] = ["IDENTIFIED", "DISCUSSED", "INTERESTED", "RECOMMENDATION", "DECISION_PENDING", "COMMITTED", "FUNDED"];

function formatInrCompact(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

const RANGE_CONFIG: Record<string, { windowDays: number; buckets: number; labelFor: (start: Date) => string }> = {
  today: { windowDays: 1, buckets: 6, labelFor: (d) => formatTime(d) },
  week: { windowDays: 7, buckets: 7, labelFor: (d) => d.toLocaleDateString("en-IN", { weekday: "short" }) },
  quarter: { windowDays: 90, buckets: 12, labelFor: (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) },
};

export async function PipelineTrendCard({
  clientFilter,
  range,
  className,
}: {
  clientFilter: Prisma.ClientWhereInput;
  range: string;
  className?: string;
}) {
  const now = new Date();
  const config = RANGE_CONFIG[range] ?? RANGE_CONFIG.week;

  const openOpportunities = await prisma.opportunity.findMany({
    where: { stage: { in: OPEN_STAGES }, client: clientFilter },
    select: { estimatedValue: true, stage: true, createdAt: true },
  });

  const opportunities = openOpportunities.map((o) => ({ ...o, estimatedValue: Number(o.estimatedValue) }));
  const pipeline = computeOpportunityPipeline(opportunities);
  const totalOpenValue = pipeline.reduce((sum, row) => sum + row.totalValue, 0);
  const totalOpenCount = pipeline.reduce((sum, row) => sum + row.count, 0);

  const windowMs = config.windowDays * 86400000;
  const bucketMs = windowMs / config.buckets;
  const windowStart = new Date(now.getTime() - windowMs);
  const data: PipelineTrendDatum[] = Array.from({ length: config.buckets }, (_, i) => {
    const bucketStart = new Date(windowStart.getTime() + i * bucketMs);
    const bucketEnd = new Date(bucketStart.getTime() + bucketMs);
    const value = opportunities
      .filter((o) => o.createdAt >= bucketStart && o.createdAt < bucketEnd)
      .reduce((sum, o) => sum + o.estimatedValue, 0);
    return { label: config.labelFor(bucketStart), value };
  });

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Pipeline this {range}</p>
        <CardTitle className="font-heading text-3xl font-extrabold tabular-nums">{formatInrCompact(totalOpenValue)}</CardTitle>
      </CardHeader>
      <CardContent>
        <PipelineTrendChart data={data} />
        <p className="mt-2 text-xs text-muted-foreground">{totalOpenCount} open opportunities</p>
      </CardContent>
    </Card>
  );
}

export function PipelineTrendCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-8 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  );
}
