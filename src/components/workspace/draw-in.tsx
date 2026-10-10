import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { motion } from "./motion-classes";

/** Reveals a chart (or any block) left to right once, in 300ms. Pure CSS, so it works in server components and is off for reduced motion. */
export function DrawIn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(motion.draw, className)}>{children}</div>;
}
