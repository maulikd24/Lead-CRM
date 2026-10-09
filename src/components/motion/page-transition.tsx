"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

import { DURATION, EASE } from "./tokens";
import { useReducedMotion } from "./use-reduced-motion";

/** Very calm route-level entrance: a short fade with a 6px rise. */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : DURATION.fast + 0.04, ease: EASE.out as unknown as [number, number, number, number] }}
    >
      {children}
    </motion.div>
  );
}
