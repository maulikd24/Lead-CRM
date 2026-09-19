"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { LeadsActivityChartDatum } from "./leads-activity-chart";

const LeadsActivityChart = dynamic(() => import("./leads-activity-chart").then((mod) => mod.LeadsActivityChart), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});

export function LeadsActivityChartLoader({ data, rmId }: { data: LeadsActivityChartDatum[]; rmId?: string }) {
  return <LeadsActivityChart data={data} rmId={rmId} />;
}
