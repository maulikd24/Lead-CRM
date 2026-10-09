"use client";

import type { ReactNode } from "react";
import { m, type Variants } from "motion/react";

import { DURATION, EASE, STAGGER } from "./tokens";
import { useMounted } from "./use-mounted";
import { useReducedMotion } from "./use-reduced-motion";

const ease = EASE.out as unknown as [number, number, number, number];

/** Server and hydration render plain visible markup; the entrance runs only after mount and never under reduced motion. */
function useAnimateEntrance() {
  const mounted = useMounted();
  const reduced = useReducedMotion();
  return mounted && !reduced;
}

export function FadeIn({ children, delay = 0, y = 8, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const animate = useAnimateEntrance();
  if (!animate) return <div className={className}>{children}</div>;
  return (
    <m.div className={className} initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DURATION.base, delay, ease }}>
      {children}
    </m.div>
  );
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease } },
};

/** Children wrapped in StaggerItem enter one after another. */
export function Stagger({ children, className, step = STAGGER }: { children: ReactNode; className?: string; step?: number }) {
  const animate = useAnimateEntrance();
  if (!animate) return <div className={className}>{children}</div>;
  return (
    <m.div className={className} initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}>
      {children}
    </m.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <m.div className={className} variants={itemVariants}>
      {children}
    </m.div>
  );
}
