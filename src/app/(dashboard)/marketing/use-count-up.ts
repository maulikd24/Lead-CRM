"use client";

import { useEffect, useState } from "react";

const DURATION_MS = 300;

/**
 * Returns the final value on the server and on the first client render (so nothing ever shows a misleading 0 at rest,
 * and no-JS and reduced-motion visitors see the real number), then counts up from 0 after mount. The visible number is
 * decorative: every tile also carries the final value as text for screen readers.
 */
export function useCountUp(value: number | null): number | null {
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return value === null || !Number.isFinite(value) ? null : value * progress;
}
