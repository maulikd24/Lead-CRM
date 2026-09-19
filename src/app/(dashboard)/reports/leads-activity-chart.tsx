"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, type BarRectangleItem } from "recharts";

export type LeadsActivityChartDatum = { label: string; created: number; updated: number; periodStart: string; periodEnd: string };

export function LeadsActivityChart({ data, rmId }: { data: LeadsActivityChartDatum[]; rmId?: string }) {
  const router = useRouter();

  function goToClients(bar: BarRectangleItem, series: "created" | "updated") {
    const bucket = bar.payload as LeadsActivityChartDatum | undefined;
    if (!bucket) return;
    const fromKey = series === "created" ? "createdFrom" : "updatedFrom";
    const toKey = series === "created" ? "createdTo" : "updatedTo";
    const params = new URLSearchParams();
    params.set(fromKey, bucket.periodStart.slice(0, 10));
    params.set(toKey, bucket.periodEnd.slice(0, 10));
    if (rmId) params.set("rm", rmId);
    router.push(`/clients?${params.toString()}`);
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 48, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
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
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="created"
            name="Created"
            fill="var(--color-chart-1)"
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(bar) => goToClients(bar, "created")}
          />
          <Bar
            dataKey="updated"
            name="Updated"
            fill="var(--color-chart-2)"
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(bar) => goToClients(bar, "updated")}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
