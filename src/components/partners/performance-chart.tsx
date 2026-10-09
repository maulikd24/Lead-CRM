import { formatInr } from "@/lib/partners/view-models";
import type { buildOverviewVM } from "@/lib/partners/view-models";

type Chart = ReturnType<typeof buildOverviewVM>["chart"];

/** Earnings by month. Plain SVG, no chart library: the line draws in with a CSS stroke animation (instant under reduced motion). */
export function PerformanceChart({ chart }: { chart: Chart }) {
  const { points, geometry: g } = chart;
  if (points.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No monthly figures yet.</p>;
  const W = 640;
  const H = 240;
  const last = points[points.length - 1];
  const summary = `Earnings by month, ${points[0].label} to ${last.label}. Latest month ${formatInr(last.earnings)}.`;

  return (
    <figure className="flex flex-col gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-auto w-full text-primary">
        <defs>
          <linearGradient id="pw-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {g.ticks.map((t, i) => (
          <g key={i}>
            <line x1={28} x2={W - 28} y1={t.y} y2={t.y} className="stroke-border" strokeDasharray={i === 0 ? undefined : "3 4"} />
            <text x={24} y={t.y + 3} textAnchor="end" className="fill-muted-foreground text-[13px]">
              {compact(t.value)}
            </text>
          </g>
        ))}
        <path d={g.area} fill="url(#pw-area)" className="pw-area" />
        <path d={g.line} pathLength={1} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="pw-line" />
        {g.dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={4} className="pw-dot fill-background stroke-current" strokeWidth={2} style={{ "--pw-i": i } as React.CSSProperties}>
            <title>{`${points[i].label}: ${formatInr(points[i].earnings)}, ${points[i].referees} new referred users`}</title>
          </circle>
        ))}
        {points.map((p, i) => (
          <text key={p.label} x={g.dots[i].x} y={H - 6} textAnchor="middle" className={`fill-muted-foreground text-[13px] ${i % 2 === 1 ? "max-sm:hidden" : ""}`}>
            {p.label}
          </text>
        ))}
      </svg>
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
