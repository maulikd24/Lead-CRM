"use client";

import { useSyncExternalStore } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DayPoint } from "@/lib/marketing/metrics";
import { formatCount, formatMoney } from "@/lib/marketing/view-model";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Live value of the reduced-motion preference (false on the server). */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches, () => false);
}

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

export function SpendFundedChart({ daily, currency }: { daily: DayPoint[]; currency: string | null }) {
  const reduced = usePrefersReducedMotion();
  const totalSpend = daily.reduce((s, d) => s + d.spend, 0);
  const totalFunded = daily.reduce((s, d) => s + d.funded, 0);
  const summary = `Daily ad spend (bars, left axis) against funded customers from that day's leads (line, right axis). ${formatMoney(totalSpend, currency)} spent and ${totalFunded} funded customers over ${daily.length} days.`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Spend and funded customers by day</CardTitle>
        <CardDescription>Two different scales: money on the left, customers on the right. Funded counts follow the day the lead arrived, so the latest days are still filling in.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div role="img" aria-label={summary} className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} minTickGap={24} stroke="var(--border)" />
              <YAxis yAxisId="spend" tick={AXIS_TICK} tickFormatter={(v: number) => formatMoney(v, currency)} width={72} stroke="var(--border)" />
              <YAxis yAxisId="funded" orientation="right" allowDecimals={false} tick={AXIS_TICK} width={32} stroke="var(--border)" />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--popover-foreground)", fontSize: 12 }}
                formatter={(value, name) => (name === "Spend" ? formatMoney(Number(value), currency) : formatCount(Number(value)))}
                labelFormatter={(label) => String(label)}
              />
              <Bar yAxisId="spend" dataKey="spend" name="Spend" fill="var(--color-chart-2)" fillOpacity={0.55} radius={[3, 3, 0, 0]} isAnimationActive={!reduced} animationDuration={900} animationEasing="ease-out" />
              <Line yAxisId="funded" type="monotone" dataKey="funded" name="Funded customers" stroke="var(--color-chart-1)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reduced} animationDuration={1400} animationEasing="ease-out" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-chart-2/60" />Spend (left axis)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-chart-1" />Funded customers (right axis)</span>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">View the chart data as a table</summary>
          <div className="mt-2 max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-left text-xs tabular-nums">
              <caption className="sr-only">Daily spend, Meta-reported leads, CRM leads and funded customers</caption>
              <thead className="sticky top-0 bg-card">
                <tr>
                  <th scope="col" className="p-2">Day</th>
                  <th scope="col" className="p-2 text-right">Spend</th>
                  <th scope="col" className="p-2 text-right">Meta leads</th>
                  <th scope="col" className="p-2 text-right">CRM leads</th>
                  <th scope="col" className="p-2 text-right">Funded</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date} className="border-t">
                    <th scope="row" className="p-2 font-normal">{d.date}</th>
                    <td className="p-2 text-right">{formatMoney(d.spend, currency)}</td>
                    <td className="p-2 text-right">{formatCount(d.metaLeads)}</td>
                    <td className="p-2 text-right">{formatCount(d.crmLeads)}</td>
                    <td className="p-2 text-right">{formatCount(d.funded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
