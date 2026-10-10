"use client";

import { useEffect, useState } from "react";

import { tweenValue } from "@/components/motion/count-up";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";

/** The longest a number may take to arrive. The whole workspace pattern keeps every animation to 300ms or less. */
export const COUNT_UP_MS = 300;

/**
 * The value to display right now. The server render, the first client render and reduced-motion visitors get the final
 * value (so nothing ever rests on a misleading 0); after mount the number counts up from 0 once.
 */
export function useCountUp(value: number | null, durationMs: number = COUNT_UP_MS): number | null {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(1);
  const animate = value !== null && Number.isFinite(value) && !reduced;

  useEffect(() => {
    if (!animate) return;
    const ms = Math.min(durationMs, COUNT_UP_MS);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setProgress(tweenValue(0, 1, t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, animate, durationMs]);

  if (value === null || !Number.isFinite(value)) return value;
  return animate ? value * progress : value;
}
