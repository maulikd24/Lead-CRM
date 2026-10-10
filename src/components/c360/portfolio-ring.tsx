"use client";

import { buildRing, type RingRow } from "@/lib/c360/ring";
import { formatPercent } from "@/lib/c360/count-up";

import { cn } from "@/lib/utils";

import { CountUp } from "./count-up";
import { useInView } from "./use-motion";

const RADIUS = 62;
const STROKE = 16;

/** Donut by asset class. The arcs draw in when scrolled into view (CSS transition); the centre AUM counts up. */
export function PortfolioRing({ rows, aum, asOfLabel, staticRender = false, compact = false }: { rows: RingRow[]; aum: number; asOfLabel: string | null; staticRender?: boolean; compact?: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const ring = buildRing(rows, { radius: RADIUS, strokeWidth: STROKE, gap: 3 });
  const c = ring.viewBox / 2;
  const description = ring.segments.map((s) => `${s.label} ${formatPercent(s.pct)}`).join(", ");

  return (
    <div ref={ref} data-in={inView ? "true" : "false"} data-static={staticRender ? "true" : undefined} className={cn("flex flex-col items-center", compact ? "gap-3" : "gap-4")}>
      <div className={cn("relative", compact ? "size-36" : "size-48")}>
        <svg viewBox={`0 0 ${ring.viewBox} ${ring.viewBox}`} role="img" aria-label={`Portfolio allocation: ${description}`} className="size-full">
          <circle cx={c} cy={c} r={RADIUS} fill="none" stroke="var(--muted)" strokeWidth={STROKE} />
          <g transform={`rotate(-90 ${c} ${c})`}>
            {ring.segments.map((s, i) => (
              <circle
                key={s.label}
                className="c360-seg"
                cx={c}
                cy={c}
                r={RADIUS}
                fill="none"
                stroke={s.color}
                strokeWidth={STROKE}
                style={{ "--len": s.length, "--c": ring.circumference, "--off": s.offset, "--k": i } as React.CSSProperties}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-muted-foreground">Total value</span>
          <CountUp value={aum} className={cn("font-heading font-semibold tracking-tight", compact ? "text-lg" : "text-2xl")} />
          {asOfLabel && <span className="mt-0.5 text-[11px] text-muted-foreground">as of {asOfLabel}</span>}
        </div>
      </div>
      <ul className={cn("grid w-full gap-1.5", compact ? "text-xs" : "text-sm")}>
        {ring.segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular-nums text-muted-foreground">{formatPercent(s.pct)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
