"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { DURATION } from "./tokens";
import { formatCount, type CountFormat } from "./format-count";
import { useReducedMotion } from "./use-reduced-motion";

/** Ease-out cubic, matching EASE.out closely; t is clamped to 0..1. */
export function tweenValue(from: number, to: number, t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return from + (to - from) * (1 - (1 - c) ** 3);
}

type Props = {
  value: number;
  format?: CountFormat;
  decimals?: number;
  duration?: number;
  /** Seconds before the first count only; later (live) updates start immediately. */
  delay?: number;
  className?: string;
};

/**
 * Counts to `value` (from the previous value when it changes) with a tiny requestAnimationFrame tween,
 * no animation library. The server, reduced-motion users and non-finite values get the final text at once.
 */
export function CountUp({ value, format = "number", decimals = 0, duration = DURATION.count, delay = 0, className }: Props) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const previous = useRef<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (reduced || !Number.isFinite(value)) {
      previous.current = null;
      return;
    }
    const before = previous.current;
    const from = before ?? 0;
    if (from === value) return;
    const wait = first.current ? delay * 1000 : 0;
    first.current = false;
    previous.current = value;
    let raf = 0;
    let startAt = 0;
    const step = (now: number) => {
      if (!startAt) startAt = now + wait;
      const t = (now - startAt) / (duration * 1000);
      setShown(t < 0 ? from : tweenValue(from, value, t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      // Restore so a StrictMode re-run (or an interrupted count) restarts from the same origin.
      previous.current = before;
      cancelAnimationFrame(raf);
    };
  }, [value, reduced, duration, delay]);

  const final = formatCount(value, format, decimals);
  const display = reduced || !Number.isFinite(value) ? final : formatCount(shown, format, decimals);
  return (
    <span className={cn("tabular-nums", className)}>
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
