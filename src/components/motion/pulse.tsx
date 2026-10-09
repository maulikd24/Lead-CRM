"use client";

import { useState, type ReactNode } from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { useReducedMotion } from "./use-reduced-motion";

/** Small live dot. The expanding ring is CSS `motion-safe`, so it is automatically off under reduced motion. */
export function Pulse({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground", className)}>
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" aria-hidden="true" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" aria-hidden="true" />
      </span>
      {label}
    </span>
  );
}

/** Wraps children and flashes a ring once each time `trigger` changes (not on first render). */
export function PulseRing({ trigger, children, className }: { trigger: number | string; children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState(trigger);
  const [shots, setShots] = useState(0);
  if (seen !== trigger) {
    setSeen(trigger);
    if (!reduced) setShots((n) => n + 1);
  }
  return (
    <div className={cn("relative", className)}>
      {children}
      {shots > 0 && (
        <motion.span
          key={shots}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-primary"
          initial={{ opacity: 0.9, scale: 1 }}
          animate={{ opacity: 0, scale: 1.03 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      )}
    </div>
  );
}
