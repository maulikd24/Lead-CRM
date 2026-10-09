"use client";

import { useChartMotion } from "@/components/motion/chart-motion";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export type PipelineTrendDatum = { label: string; value: number };

/** Chart body (no motion library). `animated` turns on Recharts' own draw-in, which honours reduced motion. */
export function PipelineTrendChart({ data, animated = false }: { data: PipelineTrendDatum[]; animated?: boolean }) {
  const motionProps = useChartMotion();
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="pipelineTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
            formatter={(value) => [`₹${Number(value).toLocaleString("en-IN")}`, "New pipeline"]}
          />
          <Area type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} fill="url(#pipelineTrendFill)" {...(animated ? motionProps : {})} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
