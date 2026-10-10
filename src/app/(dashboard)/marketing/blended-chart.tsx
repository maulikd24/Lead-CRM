"use client";

import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BlendedDay } from "@/lib/marketing/blend";
import { CHANNEL_LABEL, type AdChannel } from "@/lib/marketing/channels";
import { formatCount, formatMoney } from "@/lib/marketing/view-model";

import styles from "./marketing.module.css";

const W = 720;
const H = 224;
const M = { l: 58, r: 30, t: 10, b: 24 };
const COLOR: Record<AdChannel, string> = { meta: "var(--chart-2)", google: "var(--chart-3)" };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

const shortDate = (ymd: string) => `${ymd.slice(8)}/${ymd.slice(5, 7)}`;
const axisMoney = (v: number, currency: string | null) => formatMoney(v, currency).replace(/\.00$/, "");

/** Daily spend by channel (stacked bars, left axis) and leads received in the CRM (line, right axis). Hand-drawn SVG so it draws in with CSS and respects reduced motion. */
export function BlendedChart({ daily, channels, currency }: { daily: BlendedDay[]; channels: AdChannel[]; currency: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = daily.length;
  const innerW = W - M.l - M.r;
  const innerH = H - M.t - M.b;
  const maxSpend = niceMax(Math.max(0, ...daily.map((d) => d.spend)));
  const maxLeads = niceMax(Math.max(0, ...daily.map((d) => d.crmLeads)));
  const slot = n > 0 ? innerW / n : innerW;
  const barW = Math.max(1.5, slot * 0.68);
  const x = (i: number) => M.l + slot * i + slot / 2;
  const ySpend = (v: number) => M.t + innerH - (v / maxSpend) * innerH;
  const yLeads = (v: number) => M.t + innerH - (v / maxLeads) * innerH;
  const line = daily.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${yLeads(d.crmLeads).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const totalSpend = daily.reduce((s, d) => s + d.spend, 0);
  const totalLeads = daily.reduce((s, d) => s + d.crmLeads, 0);
  const summary = `Daily ad spend by channel (bars, left axis) against leads received in the CRM (line, right axis). ${formatMoney(totalSpend, currency)} spent and ${formatCount(totalLeads)} leads over ${n} days.`;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.floor((px - M.l) / slot);
    setHover(i >= 0 && i < n ? i : null);
  }

  const active = hover !== null ? daily[hover] : null;

  return (
    <Card className={styles.enter}>
      <CardHeader>
        <CardTitle className="font-heading">Spend and leads by day</CardTitle>
        <CardDescription>Money on the left, leads on the right. Leads follow the day they arrived in the CRM.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-auto w-full touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.l} x2={W - M.r} y1={M.t + innerH - t * innerH} y2={M.t + innerH - t * innerH} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 3"} />
                <text x={M.l - 6} y={M.t + innerH - t * innerH + 3.5} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">{axisMoney(maxSpend * t, currency)}</text>
                <text x={W - M.r + 6} y={M.t + innerH - t * innerH + 3.5} textAnchor="start" fontSize="11" fill="var(--muted-foreground)">{formatCount(maxLeads * t)}</text>
              </g>
            ))}
            {daily.map((d, i) => {
              let top = 0;
              return (
                <g key={d.date} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {channels.map((c) => {
                    const v = d.byChannel[c];
                    if (v <= 0) return null;
                    const y0 = ySpend(top);
                    top += v;
                    const y1 = ySpend(top);
                    return <rect key={c} className={styles.chartBar} style={{ ["--i" as string]: Math.min(i, 40) }} x={x(i) - barW / 2} y={y1} width={barW} height={Math.max(0, y0 - y1)} fill={COLOR[c]} fillOpacity={0.72} rx={1} />;
                  })}
                </g>
              );
            })}
            {n > 0 && <path d={line} pathLength={1} className={styles.chartLine} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
            {n > 0 && n <= 40 && (
              <g className={styles.chartDots}>
                {daily.map((d, i) => <circle key={d.date} cx={x(i)} cy={yLeads(d.crmLeads)} r={2.5} fill="var(--chart-1)" />)}
              </g>
            )}
            {daily.map((d, i) => (i % labelEvery === 0 ? <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{shortDate(d.date)}</text> : null))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + innerH} stroke="var(--foreground)" strokeOpacity={0.35} />}
          </svg>
          {active && (
            <div role="status" className="pointer-events-none absolute top-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md" style={{ left: `${Math.min(78, Math.max(2, (x(hover ?? 0) / W) * 100 - 10))}%` }}>
              <p className="font-medium">{active.date}</p>
              {channels.map((c) => <p key={c} className="tabular-nums">{`${CHANNEL_LABEL[c]}: ${formatMoney(active.byChannel[c], currency)}`}</p>)}
              <p className="tabular-nums">{`Leads: ${formatCount(active.crmLeads)}`}</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
          {channels.map((c) => <span key={c} className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: COLOR[c], opacity: 0.72 }} />{`${CHANNEL_LABEL[c]} spend`}</span>)}
          <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 rounded bg-chart-1" />Leads in the CRM</span>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">View the chart data as a table</summary>
          <div className="mt-2 max-h-56 overflow-auto rounded-md border">
            <table className="w-full text-left text-xs tabular-nums">
              <caption className="sr-only">Daily spend by channel and leads received</caption>
              <thead className="sticky top-0 bg-card">
                <tr>
                  <th scope="col" className="p-2">Day</th>
                  {channels.map((c) => <th key={c} scope="col" className="p-2 text-right">{`${CHANNEL_LABEL[c]} spend`}</th>)}
                  <th scope="col" className="p-2 text-right">Leads</th>
                  <th scope="col" className="p-2 text-right">Funded</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.date} className="border-t">
                    <th scope="row" className="p-2 font-normal">{d.date}</th>
                    {channels.map((c) => <td key={c} className="p-2 text-right">{formatMoney(d.byChannel[c], currency)}</td>)}
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
