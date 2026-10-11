import { useId } from "react";

import { motion } from "@/components/workspace/motion-classes";
import { cn } from "@/lib/utils";

import { areaPath, hasHistory, linePath } from "./wow-logic";
import styles from "./wow.module.css";

const W = 120;
const H = 36;
const BOX = { w: W, h: H, pad: 3 };

/**
 * A soft area sparkline under or beside a figure. It reveals left to right once (300ms, off under reduced motion) and it is only
 * ever drawn from real history: with fewer than two points, or nothing but zeros, it renders nothing at all rather than a fake line.
 * The figure beside it carries the meaning; this has a short text equivalent for assistive tech.
 */
export function AreaSparkline({ values, label, tone = "up", className }: { values: readonly number[] | null | undefined; label?: string; tone?: "up" | "down"; className?: string }) {
  const id = useId();
  if (!hasHistory(values)) return null;
  const first = values[0];
  const last = values[values.length - 1];
  const text = label ?? `Last ${values.length} days: from ${Math.round(first)} to ${Math.round(last)}`;
  return (
    <span className={cn(motion.draw, styles.sparkWrap)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={text} className={cn(styles.spark, className)} data-tone={tone} focusable="false">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath(values, BOX)} fill={`url(#${id}-fill)`} />
        <path d={linePath(values, BOX)} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  );
}
