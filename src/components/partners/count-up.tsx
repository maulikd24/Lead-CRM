"use client";

import { useEffect, useState } from "react";

import { countUpValue } from "@/lib/partners/count-up";
import { formatInr } from "@/lib/partners/view-models";

/**
 * Number that climbs to its value on first paint. The server render (and anyone with reduced motion
 * or no JavaScript) shows the final value straight away, so the number is never wrong, only calmer.
 */
export function CountUp({ value, format = "number", durationMs = 900 }: { value: number | null; format?: "number" | "inr"; durationMs?: number }) {
  const [shown, setShown] = useState(value ?? 0);

  useEffect(() => {
    if (value === null || typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0) return;
    const integer = Number.isInteger(value);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      setShown(countUpValue(value, p, integer));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  if (value === null) return <span className="tabular-nums" title="Not reported by the service">—</span>;
  return <span className="tabular-nums">{format === "inr" ? formatInr(shown) : shown.toLocaleString("en-IN")}</span>;
}
