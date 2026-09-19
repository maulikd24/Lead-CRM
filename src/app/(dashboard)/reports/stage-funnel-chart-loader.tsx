"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { StageFunnelChartDatum } from "./stage-funnel-chart";

const StageFunnelChart = dynamic(() => import("./stage-funnel-chart").then((mod) => mod.StageFunnelChart), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});

export function StageFunnelChartLoader({ data }: { data: StageFunnelChartDatum[] }) {
  return <StageFunnelChart data={data} />;
}
