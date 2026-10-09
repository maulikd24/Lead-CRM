"use client";

// Tiny local motion helpers. Deliberately not a dependency: when the shared motion toolkit lands, replace these
// three hooks with its equivalents and leave the components alone.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { countUpValue } from "@/lib/c360/count-up";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/** True once the element has scrolled into view (and stays true). Falls back to true without IntersectionObserver. */
export function useInView<T extends Element>(): [(node: T | null) => void, boolean] {
  const [inView, setInView] = useState(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    observer.current = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.current?.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.current.observe(node);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, inView];
}

/** Counts from 0 to `target` once `start` is true. Server render and reduced motion show the final value. */
export function useCountUp(target: number, opts: { start: boolean; durationMs?: number; decimals?: number }): number {
  const { start, durationMs = 1000, decimals = 0 } = opts;
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (reduced || !start || !Number.isFinite(target)) return;
    let frame = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      setProgress(p);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, start, reduced, durationMs]);

  if (!Number.isFinite(target)) return 0;
  if (reduced || progress === null) return target;
  return countUpValue(0, target, progress, decimals);
}
