"use client";

import { useChartMotion, DrawIn } from "@/components/motion/draw-in";
import { motionEnabled } from "@/components/motion/tokens";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export type PipelineTrendDatum = { label: string; value: number };

export function PipelineTrendChart({ data }: { data: PipelineTrendDatum[] }) {
  const animated = motionEnabled();
  const motionProps = useChartMotion();
  const Wrapper = animated ? DrawIn : "div";
  return (
    <Wrapper className="h-40 w-full">
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
    </Wrapper>
  );
}
