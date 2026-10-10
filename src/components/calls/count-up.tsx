"use client";

import { useEffect, useState } from "react";

/** Counts up to `value` once on mount. Server render shows the final number; reduced motion jumps straight to it. */
export function CountUp({ value, durationMs = 300 }: { value: number; durationMs?: number }) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = reduced ? 1 : Math.min(1, (now - start) / durationMs);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);

  return <span className="tabular-nums">{shown.toLocaleString("en-IN")}</span>;
}
