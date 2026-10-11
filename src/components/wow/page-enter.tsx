"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import styles from "./wow.module.css";

/**
 * A page change fades the new page in once (200ms, opacity only, so it cannot create a containing block for fixed bars). Keyed by
 * the path, so a tab change on the same page does not replay it. Off under reduced motion.
 */
export function PageEnter({ children, className }: { children: ReactNode; className?: string }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className={cn(styles.pageEnter, className)}>
      {children}
    </div>
  );
}
