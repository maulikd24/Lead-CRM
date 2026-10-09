"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { animate } from "motion/react";

import { cn } from "@/lib/utils";
import { DURATION, EASE } from "./tokens";
import { formatCount, type CountFormat } from "./format-count";
import { useReducedMotion } from "./use-reduced-motion";

type Props = {
  value: number;
  format?: CountFormat;
  decimals?: number;
  duration?: number;
  /** Seconds to wait before the first count. */
  delay?: number;
  className?: string;
};

/**
 * Animates a number to `value` (and from the previous value when it changes).
 * The server and reduced-motion users always get the final value immediately.
 */
export function CountUp({ value, format = "number", decimals = 0, duration = DURATION.count, delay = 0, className }: Props) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (reduced) {
      previous.current = value;
      return;
    }
    const from = previous.current ?? 0;
    previous.current = value;
    if (from === value) return;
    // Runs before paint, so the server's final value is never visible ahead of the count from `from`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown(from);
    const controls = animate(from, value, { duration, delay, ease: EASE.out as unknown as [number, number, number, number], onUpdate: setShown });
    return () => controls.stop();
  }, [value, reduced, duration, delay]);

  const final = formatCount(value, format, decimals);
  return (
    <span className={cn("tabular-nums", className)}>
      <span aria-hidden="true">{formatCount(reduced ? value : shown, format, decimals)}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
