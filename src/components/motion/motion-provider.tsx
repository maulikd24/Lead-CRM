"use client";

import type { ReactNode } from "react";
import { LazyMotion, MotionConfig } from "motion/react";

/** The one place the motion library is mounted. Features load lazily; `m.*` components elsewhere stay tiny. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={() => import("./features").then((m) => m.default)} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
