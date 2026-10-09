"use client";

import { useEffect, useState } from "react";

import { useReducedMotion } from "./use-reduced-motion";

/** The text shown once the number has settled. Also the text-to-speech version, so assistive tech never hears the tween. */
export function formatCount(value: number, decimals = 0, prefix = "", suffix = ""): string {
  return `${prefix}${value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
}

export function CountUp({ value, decimals = 0, prefix = "", suffix = "", duration = 900 }: { value: number; decimals?: number; prefix?: string; suffix?: string; duration?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, duration]);

  const display = reduced ? value : shown;
  const final = formatCount(value, decimals, prefix, suffix);
  return (
    <span className="tabular-nums">
      <span aria-hidden="true">{formatCount(display, decimals, prefix, suffix)}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
