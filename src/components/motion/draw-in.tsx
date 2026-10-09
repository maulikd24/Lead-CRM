"use client";

import type { ReactNode } from "react";
import { m } from "motion/react";

import { DURATION, EASE } from "./tokens";
import { useMounted } from "./use-mounted";
import { useReducedMotion } from "./use-reduced-motion";

const ease = EASE.out as unknown as [number, number, number, number];

export { chartMotionProps, useChartMotion } from "./chart-motion";

/** Left-to-right reveal wrapper for a chart container. */
export function DrawIn({ children, className }: { children: ReactNode; className?: string }) {
  const mounted = useMounted();
  const reduced = useReducedMotion();
  const animate = mounted && !reduced;
  if (!animate) return <div className={className}>{children}</div>;
  return (
    <m.div className={className} initial={{ clipPath: "inset(0 100% 0 0)" }} animate={{ clipPath: "inset(0 0% 0 0)" }} transition={{ duration: DURATION.chart, ease }}>
      {children}
    </m.div>
  );
}

/** SVG path that draws itself (use inside an <svg>). Static until mounted. */
export function DrawPath({ d, className, strokeWidth = 1.5, delay = 0 }: { d: string; className?: string; strokeWidth?: number; delay?: number }) {
  const mounted = useMounted();
  const reduced = useReducedMotion();
  const animate = mounted && !reduced;
  const common = { d, className, fill: "none", stroke: "currentColor", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (!animate) return <path {...common} />;
  return <m.path {...common} initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: DURATION.chart, delay, ease }} />;
}
