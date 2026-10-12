"use client";

import { DrawIn } from "@/components/motion/draw-in";
import { PipelineTrendChart, type PipelineTrendDatum } from "./pipeline-trend-chart";

/** Flag-on variant: the same chart revealed left to right. Only loaded when NEXT_PUBLIC_MOTION=1. */
export function PipelineTrendChartAnimated({ data }: { data: PipelineTrendDatum[] }) {
  return (
    <DrawIn>
      <PipelineTrendChart data={data} animated />
    </DrawIn>
  );
}
