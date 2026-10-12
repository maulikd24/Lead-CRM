"use client";

import type { ReactNode } from "react";
import { m } from "motion/react";

import { DURATION, EASE } from "./tokens";
import { useMounted } from "./use-mounted";
import { useReducedMotion } from "./use-reduced-motion";

/** Very calm entrance: a short fade with a 6px rise, only after mount; server HTML is fully visible. */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const mounted = useMounted();
  const reduced = useReducedMotion();
  const animate = mounted && !reduced;
  if (!animate) return <div className={className}>{children}</div>;
  return (
    <m.div className={className} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DURATION.fast + 0.04, ease: EASE.out as unknown as [number, number, number, number] }}>
      {children}
    </m.div>
  );
}
