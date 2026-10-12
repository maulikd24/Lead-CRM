import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

import styles from "./workspace.module.css";

/**
 * Loading placeholder shaped like the thing that is coming. A still block that fades in once: no shimmer loop, no spinner.
 * Wrap a group of them in an element with aria-busy="true" and an aria-label.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden className={cn(styles.skeleton, className)} {...props} />;
}
