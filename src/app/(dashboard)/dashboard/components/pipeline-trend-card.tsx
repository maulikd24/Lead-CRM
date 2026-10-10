import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard } from "@/components/wow/chart-card";
import { PhoneSheet } from "@/components/workspace";
import { formatInrCompact } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { pipelineSeries, type PipelineRange } from "@/lib/wow/pipeline-series";
import type { Prisma } from "@/generated/prisma/client";

const RANGE_WORD: Record<PipelineRange, string> = { today: "today", week: "this week", quarter: "this quarter" };
const PERIOD_LABEL: Record<PipelineRange, string> = { today: "vs yesterday", week: "vs last week", quarter: "vs last quarter" };

/**
 * The pipeline chart: what opened in the period, switchable between the value of new opportunities, how many there were and
 * how many new clients came in. The numbers are real (opportunities and clients created in each slice of the period, compared
 * with the period before), nothing is smoothed over or filled in.
 */
export async function PipelineTrendCard({ clientFilter, range, className }: { clientFilter: Prisma.ClientWhereInput; range: string; className?: string }) {
  const r: PipelineRange = range === "today" || range === "quarter" ? range : "week";
  const data = await pipelineSeries(clientFilter, r);
  const total = data.value.reduce((a, b) => a + b, 0);
  const chart = (
    <ChartCard
      className={className}
      title={`Pipeline ${RANGE_WORD[r]}`}
      description="What opened in the period"
      labels={data.labels}
      deltaLabel={PERIOD_LABEL[r]}
      series={[
        { key: "value", label: "Pipeline value", values: data.value, format: { kind: "inr" }, delta: data.delta.value },
        { key: "opps", label: "Opportunities", values: data.opportunities, format: { kind: "count" }, delta: data.delta.opportunities },
        { key: "clients", label: "New clients", values: data.clients, format: { kind: "count" }, delta: data.delta.clients },
      ]}
      footer={
        <>
          {data.openCount} open opportunities worth {formatInrCompact(data.openValue)} in total
        </>
      }
    />
  );
  // A phone gets one dense row (the real headline); the chart opens in a sheet. A laptop shows the chart in place.
  return (
    <PhoneSheet name="pipeline-trend" title={`Pipeline ${RANGE_WORD[r]}`} summary={`${formatInrCompact(total)} opened, ${data.opportunities.reduce((a, b) => a + b, 0)} opportunities`}>
      {chart}
    </PhoneSheet>
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
