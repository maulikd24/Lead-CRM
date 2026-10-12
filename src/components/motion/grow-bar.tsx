"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { motionEnabled } from "./tokens";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * A bar (or one segment of a stacked bar) that grows from nothing to its width once, after mount — CSS only, no motion library.
 * Server render, motion off and reduced motion all show the final width at once.
 */
export function GrowBar({ pct, delayMs = 0, className }: { pct: number; delayMs?: number; className?: string }) {
  const reduced = useReducedMotion();
  const animate = motionEnabled() && !reduced;
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (!animate) return;
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [animate]);
  const width = `${Math.max(0, Math.min(100, pct))}%`;
  return (
    <div
      className={cn("h-full", animate && "transition-[width] duration-300 ease-out", className)}
      style={{ width: !animate || grown ? width : "0%", transitionDelay: animate ? `${delayMs}ms` : undefined }}
    />
  );
}
