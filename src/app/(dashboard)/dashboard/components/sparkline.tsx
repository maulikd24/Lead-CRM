"use client";

import { DrawPath } from "@/components/motion/draw-in";

/** Tiny trend line that draws itself in. Purely decorative: the number beside it carries the meaning. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 64;
  const h = 20;
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const span = max - min || 1;
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className ?? "h-5 w-16 text-primary"} aria-hidden="true" focusable="false">
      <DrawPath d={d} />
    </svg>
  );
}
