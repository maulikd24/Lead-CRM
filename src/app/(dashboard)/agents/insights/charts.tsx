"use client";

import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/shared/empty-state";
import { OUTCOMES } from "@/lib/intelligence/constants";
import { fmtPct } from "@/lib/insights/format";
import type { InsightsData } from "@/lib/insights/compose";
import type { OutcomeMixGroup } from "@/lib/insights/response-analytics";
import { useReducedMotion } from "./use-reduced-motion";

/** One theme colour per outcome. Positive outcomes sit in the lime and green family, declines in red, the rest in neutral accents. */
const OUTCOME_COLOUR: Record<string, string> = {
  INTERESTED: "var(--chart-1)",
  CONVERTED: "var(--chart-4)",
  FOLLOW_UP: "var(--chart-5)",
  RM_HANDOVER: "var(--chart-2)",
  SERVICE_ISSUE: "var(--chart-3)",
  NOT_INTERESTED: "var(--destructive)",
  NOT_RELEVANT: "var(--muted-foreground)",
};

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--popover-foreground)",
  fontSize: 12,
} as const;

const DIMENSIONS = [
  { key: "assetClass", label: "Asset class" },
  { key: "programme", label: "Nudge programme" },
  { key: "channel", label: "Channel" },
  { key: "language", label: "Language" },
  { key: "rm", label: "RM" },
] as const;

type DimensionKey = (typeof DIMENSIONS)[number]["key"];

export function OutcomeMixPanel({ mix }: { mix: InsightsData["mix"] }) {
  const [dim, setDim] = useState<DimensionKey>("assetClass");
  const reduced = useReducedMotion();
  const groups: OutcomeMixGroup[] = mix[dim].slice(0, 8);
  const label = DIMENSIONS.find((d) => d.key === dim)!.label;
  const data = groups.map((g) => ({ name: g.key, ...g.counts }));

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Group outcomes by" className="flex flex-wrap gap-1.5">
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            aria-pressed={dim === d.key}
            onClick={() => setDim(d.key)}
            className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-primary aria-pressed:bg-primary/15 aria-pressed:text-foreground"
          >
            {d.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={BarChart3} title="No outcomes recorded in this period" description="Outcomes appear here as RMs and agents log what customers said." />
      ) : (
        <>
          <div aria-hidden="true" style={{ height: Math.max(140, groups.length * 38 + 36) }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart accessibilityLayer={false} data={data} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => `${Math.round(v * 100)}%`} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={128} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
                {OUTCOMES.map((o) => (
                  <Bar key={o.value} dataKey={o.value} name={o.label} stackId="mix" fill={OUTCOME_COLOUR[o.value]} isAnimationActive={!reduced} animationDuration={300} animationEasing="ease-out" />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {OUTCOMES.map((o) => (
              <li key={o.value} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: OUTCOME_COLOUR[o.value] }} aria-hidden="true" />
                {o.label}
              </li>
            ))}
          </ul>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Outcome mix by {label.toLowerCase()}</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">{label}</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Outcomes</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Interested or converted</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Declined</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.key} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">{g.key}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{g.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-success">{fmtPct(g.positiveRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-destructive">{fmtPct(g.declineRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function ReplyDelayChart({ buckets }: { buckets: InsightsData["response"]["buckets"] }) {
  const reduced = useReducedMotion();
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return <EmptyState icon={BarChart3} title="No replies yet" description="Reply times appear once customers answer messages sent in this period." />;
  return (
    <figure className="m-0">
      <div aria-hidden="true" className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer={false} data={buckets} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} interval={0} />
            <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--accent)" }} />
            <Bar dataKey="count" name="Replies" radius={[4, 4, 0, 0]} isAnimationActive={!reduced} animationDuration={300} animationEasing="ease-out">
              {buckets.map((b) => (
                <Cell key={b.label} fill="var(--chart-1)" />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">
        Time to first reply: {buckets.map((b) => `${b.label}, ${b.count}`).join("; ")}.
      </figcaption>
    </figure>
  );
}
