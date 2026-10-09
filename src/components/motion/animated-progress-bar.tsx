"use client";

import { motion } from "motion/react";

import { DURATION, EASE } from "./tokens";
import { useReducedMotion } from "./use-reduced-motion";

/** Same look as the shared ProgressBar, but the fill grows in (instant under reduced motion). */
export function AnimatedProgressBar({ value, delay = 0 }: { value: number; delay?: number }) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="mt-3 h-1.5 rounded-full bg-muted">
      <motion.div
        className="h-full rounded-full bg-primary"
        initial={reduced ? false : { width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: reduced ? 0 : DURATION.slow, delay: reduced ? 0 : delay, ease: EASE.out as unknown as [number, number, number, number] }}
      />
    </div>
  );
}
