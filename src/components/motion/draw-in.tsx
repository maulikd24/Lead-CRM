"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

import { DURATION, EASE } from "./tokens";
import { useReducedMotion } from "./use-reduced-motion";

const ease = EASE.out as unknown as [number, number, number, number];

/** Props to spread on a Recharts series (Line/Area/Bar). Off under reduced motion. */
export function chartMotionProps(reduced: boolean): { isAnimationActive: boolean; animationDuration?: number; animationEasing?: "ease-out" } {
  if (reduced) return { isAnimationActive: false };
  return { isAnimationActive: true, animationDuration: Math.round(DURATION.chart * 1000), animationEasing: "ease-out" };
}

export function useChartMotion() {
  return chartMotionProps(useReducedMotion());
}

/** Left-to-right reveal wrapper for a chart container. */
export function DrawIn({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { clipPath: "inset(0 100% 0 0)" }}
      animate={{ clipPath: "inset(0 0% 0 0)" }}
      transition={{ duration: reduced ? 0 : DURATION.chart, ease }}
    >
      {children}
    </motion.div>
  );
}

/** SVG path that draws itself (use inside an <svg>). */
export function DrawPath({ d, className, strokeWidth = 1.5, delay = 0 }: { d: string; className?: string; strokeWidth?: number; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.path
      d={d}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={reduced ? false : { pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ duration: reduced ? 0 : DURATION.chart, delay: reduced ? 0 : delay, ease }}
    />
  );
}
