import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import styles from "./density.module.css";

/**
 * The page's primary actions. On a phone it is a bar fixed to the bottom of the screen, within thumb reach (large targets that
 * share the width; the page keeps room for it). From 1024px it is an ordinary row inside the header. Put at most three actions in it;
 * a button that should stay narrow (an icon) carries `data-bar-icon`. Everything secondary belongs behind a <UrlSheet>.
 *
 * It is a labelled group, so assistive technology announces it once.
 */
export function StickyActionBar({ children, label = "Primary actions", className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <div role="group" aria-label={label} data-action-bar="true" className={cn(styles.actionBar, className)}>
      {children}
    </div>
  );
}
