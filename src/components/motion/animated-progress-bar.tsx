"use client";

import { m } from "motion/react";

import { DURATION, EASE } from "./tokens";
import { useMounted } from "./use-mounted";
import { useReducedMotion } from "./use-reduced-motion";

/** Same look as the shared ProgressBar, but the fill grows in (instant under reduced motion). */
export function AnimatedProgressBar({ value, delay = 0 }: { value: number; delay?: number }) {
  const mounted = useMounted();
  const reduced = useReducedMotion();
  const animate = mounted && !reduced;
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="mt-3 h-1.5 rounded-full bg-muted">
      {animate ? (
        <m.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: DURATION.slow, delay, ease: EASE.out as unknown as [number, number, number, number] }}
        />
      ) : (
        <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
      )}
    </div>
  );
}
