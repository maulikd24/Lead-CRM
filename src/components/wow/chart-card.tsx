"use client";

import { useState, type ReactNode } from "react";

import { CountUp } from "@/components/workspace/count-up";
import { Skeleton } from "@/components/workspace/skeleton";
import { motion } from "@/components/workspace/motion-classes";
import { cn } from "@/lib/utils";

import { AreaChart, type ChartSeries } from "./area-chart";
import { DeltaChip, type GoodWhen } from "./kpi-card";
import { SegmentedToggle } from "./segmented-toggle";
import styles from "./wow.module.css";
import { formatValue, splitHalves, computeDelta, type Delta } from "./wow-logic";

/** The headline figure of a series: the total, the latest point or the average. Pure, so it is tested. */
export function headlineOf(s: Pick<ChartSeries, "values" | "headline">): number | null {
  if (s.values.length === 0) return null;
  const mode = s.headline ?? "sum";
  if (mode === "last") return s.values[s.values.length - 1];
  const total = s.values.reduce((a, b) => a + b, 0);
  return mode === "avg" ? total / s.values.length : total;
}

/** The delta shown beside the headline: the series' own when the server computed one, otherwise the later half of the range against the earlier half. */
export function deltaOf(s: Pick<ChartSeries, "values" | "delta">): Delta | null {
  if (s.delta !== undefined) return s.delta;
  const h = splitHalves(s.values);
  return h ? computeDelta(h.current, h.previous) : null;
}

/**
 * A chart card: title, a segmented toggle that switches the series with a smooth morph, the headline figure (counts up on a
 * switch) with its change, and the area chart. Series are real data from the page's loaders; with one series there is no toggle.
 */
export function ChartCard({
  title,
  description,
  labels,
  series,
  defaultKey,
  goodWhen = "up",
  deltaLabel = "vs earlier half",
  footer,
  className,
  height,
}: {
  title: string;
  description?: ReactNode;
  labels: string[];
  series: ChartSeries[];
  defaultKey?: string;
  goodWhen?: GoodWhen;
  deltaLabel?: string;
  footer?: ReactNode;
  className?: string;
  height?: number;
}) {
  const [key, setKey] = useState(defaultKey ?? series[0]?.key ?? "");
  const active = series.find((s) => s.key === key) ?? series[0];
  if (!active) return null;
  const headline = headlineOf(active);
  const delta = deltaOf(active);
  const f = active.format;
  const countProps = f.kind === "inr" ? { prefix: "₹" } : f.kind === "percent" ? { suffix: "%", decimals: f.decimals ?? 0 } : {};
  return (
    <section className={cn(styles.chartCard, motion.enter, className)} aria-label={title}>
      <div className={styles.chartHead}>
        <div className="min-w-0">
          <h3 className={styles.chartTitle}>{title}</h3>
          {description && <p className={styles.chartDesc}>{description}</p>}
        </div>
        {series.length > 1 && <SegmentedToggle options={series.map((s) => ({ key: s.key, label: s.label }))} value={active.key} onChange={setKey} label={`${title}: choose what to chart`} />}
      </div>
      <div className={styles.chartHeadline}>
        <p className={styles.chartValue}>
          {headline === null ? "—" : f.kind === "money" ? formatValue(f, headline) : <CountUp key={active.key} value={headline} label={active.label} {...countProps} />}
        </p>
        {delta && (
          <span className="inline-flex items-center gap-1.5 text-xs">
            <DeltaChip delta={delta} goodWhen={goodWhen} label={deltaLabel} />
          </span>
        )}
      </div>
      <AreaChart labels={labels} series={series} activeKey={active.key} ariaLabel={`${title}, ${active.label}`} height={height} />
      {footer && <div className={styles.chartSub}>{footer}</div>}
    </section>
  );
}

export function ChartCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn(styles.chartCard, className)} aria-busy="true" aria-label="Loading chart">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-[14rem] w-full" />
    </div>
  );
}
