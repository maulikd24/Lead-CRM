import "./calls.css";

import { cn } from "@/lib/utils";
import { scoreBand, type Band } from "@/lib/calls/view-model";

const STROKE: Record<Band, string> = { low: "stroke-destructive", mid: "stroke-warning", high: "stroke-success" };
const TEXT: Record<Band, string> = { low: "text-destructive", mid: "text-warning", high: "text-success" };

const SIZES = { sm: { box: 44, r: 18, w: 4, text: "text-sm" }, lg: { box: 120, r: 50, w: 8, text: "text-4xl" } } as const;

/** A score from 0 to 100 as a ring that draws itself in. Colour is never the only signal: the number is always printed. */
export function QualityRing({ score, size = "sm", className }: { score: number | null; size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  const band = scoreBand(score);
  const circ = 2 * Math.PI * s.r;
  const target = score === null ? circ : circ * (1 - Math.min(100, Math.max(0, score)) / 100);
  const c = s.box / 2;

  return (
    <div
      role="img"
      aria-label={score === null ? "No quality score yet" : `Quality score ${score} out of 100`}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: s.box, height: s.box }}
    >
      <svg width={s.box} height={s.box} viewBox={`0 0 ${s.box} ${s.box}`} className="-rotate-90" aria-hidden="true">
        <circle cx={c} cy={c} r={s.r} fill="none" strokeWidth={s.w} className="stroke-border" />
        {score !== null && band && (
          <circle
            cx={c}
            cy={c}
            r={s.r}
            fill="none"
            strokeWidth={s.w}
            strokeLinecap="round"
            className={cn("calls-ring-arc", STROKE[band])}
            style={{ "--ring-circ": circ, "--ring-target": target } as React.CSSProperties}
          />
        )}
      </svg>
      <span className={cn("absolute font-heading font-semibold tabular-nums", s.text, band ? TEXT[band] : "text-muted-foreground")}>{score === null ? "–" : score}</span>
    </div>
  );
}
