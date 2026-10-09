"use client";

import { useEffect, useState } from "react";

const DURATION_MS = 800;

/**
 * Counts from 0 up to `value` with an ease-out curve. People who ask for reduced motion get the final number on the
 * first frame. The visible number is decorative: every tile also carries the final value as text for screen readers.
 */
export function useCountUp(value: number | null): number | null {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / DURATION_MS);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return value === null || !Number.isFinite(value) ? null : value * progress;
}
