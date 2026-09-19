"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarRectangleItem } from "recharts";

export type StageFunnelChartDatum = { stage: string; stageId: string; count: number };

const LOST_STAGE_ID = "__LOST__";

export function StageFunnelChart({ data }: { data: StageFunnelChartDatum[] }) {
  const router = useRouter();

  function goToClients(bar: BarRectangleItem) {
    const bucket = bar.payload as StageFunnelChartDatum | undefined;
    if (!bucket) return;
    const href =
      bucket.stageId === LOST_STAGE_ID
        ? "/clients?status=NOT_PROCEEDING"
        : `/clients?stage=${encodeURIComponent(bucket.stageId)}`;
    router.push(href);
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 48, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="stage"
            angle={-30}
            textAnchor="end"
            interval={0}
            height={70}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor="pointer" onClick={goToClients}>
            {data.map((entry) => (
              <Cell
                key={entry.stageId}
                fill={entry.stageId === LOST_STAGE_ID ? "var(--destructive)" : "var(--color-chart-1)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
