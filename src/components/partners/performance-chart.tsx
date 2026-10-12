import { motion } from "@/components/workspace";
import { cn } from "@/lib/utils";
import { formatInr } from "@/lib/partners/view-models";
import type { buildOverviewVM } from "@/lib/partners/view-models";

type Chart = ReturnType<typeof buildOverviewVM>["chart"];

/** Earnings by month. Plain SVG, no chart library: the plot reveals left to right once in 300ms (instant under reduced motion). */
export function PerformanceChart({ chart }: { chart: Chart }) {
  const { points, geometry: g } = chart;
  if (points.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No monthly figures yet.</p>;
  const W = 640;
  const H = 240;
  const last = points[points.length - 1];
  const summary = `Earnings by month, ${points[0].label} to ${last.label}. Latest month ${formatInr(last.earnings)}.`;

  const pctX = (x: number) => `${(x / W) * 100}%`;
  const pctY = (y: number) => `${(y / H) * 100}%`;

  // The plot is a stretched SVG (lines and fill only, so stretching cannot distort anything). Text and dots are HTML laid
  // over it at the same proportional positions, so labels keep a fixed readable size at any width.
  return (
    <figure className="flex flex-col gap-1.5">
      <div role="img" aria-label={summary} className={cn(motion.draw, "relative h-56 w-full text-primary sm:h-64")}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className="absolute inset-0 size-full">
          <defs>
            <linearGradient id="pw-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {g.ticks.map((tk, i) => (
            <line key={i} x1={0} x2={W} y1={tk.y} y2={tk.y} vectorEffect="non-scaling-stroke" className="stroke-border" strokeDasharray={i === 0 ? undefined : "3 4"} />
          ))}
          <path d={g.area} fill="url(#pw-area)" />
          <path d={g.line} fill="none" stroke="currentColor" strokeWidth={2.5} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" data-chart-line />
        </svg>
        {g.ticks.map((tk, i) => (
          <span key={i} aria-hidden className="absolute left-1 -translate-y-full pb-0.5 text-xs tabular-nums text-muted-foreground" style={{ top: pctY(tk.y) }}>
            {compact(tk.value)}
          </span>
        ))}
        {g.dots.map((d, i) => (
          <span
            key={i}
            title={`${points[i].label}: ${formatInr(points[i].earnings)}, ${points[i].referees} new referred users`}
            className="absolute -ml-1 -mt-1 size-2 rounded-full border-2 border-current bg-background"
            style={{ left: pctX(d.x), top: pctY(d.y) }}
          />
        ))}
      </div>
      <div aria-hidden className="relative h-5 w-full">
        {points.map((p, i) => (
          <span key={p.label} className={`absolute -translate-x-1/2 whitespace-nowrap text-xs text-muted-foreground ${i % 2 === 1 ? "max-sm:hidden" : ""}`} style={{ left: pctX(g.dots[i].x) }}>
            {p.label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        <table>
          <thead><tr><th>Month</th><th>Earnings</th><th>New referred users</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}><td>{p.label}</td><td>{formatInr(p.earnings)}</td><td>{p.referees}</td></tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

function compact(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
}
