"use client";

import type { ReactNode } from "react";
import { motion, type Variants } from "motion/react";

import { DURATION, EASE, STAGGER } from "./tokens";
import { useReducedMotion } from "./use-reduced-motion";

const ease = EASE.out as unknown as [number, number, number, number];

export function FadeIn({ children, delay = 0, y = 8, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : DURATION.base, delay: reduced ? 0 : delay, ease }}
    >
      {children}
    </motion.div>
  );
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease } },
};

/** Children wrapped in StaggerItem enter one after another. */
export function Stagger({ children, className, step = STAGGER }: { children: ReactNode; className?: string; step?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div className={className} initial={reduced ? false : "hidden"} animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
