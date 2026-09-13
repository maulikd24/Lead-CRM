"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

const LeadsActivityChart = dynamic(() => import("./leads-activity-chart").then((mod) => mod.LeadsActivityChart), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});

export function LeadsActivityChartLoader({ data }: { data: { label: string; created: number; updated: number }[] }) {
  return <LeadsActivityChart data={data} />;
}
