import type { ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import styles from "./density.module.css";

const TONE = { default: "", success: "text-success", warning: "text-warning", destructive: "text-destructive" } as const;

/**
 * Key facts as a horizontally swipeable strip of small chips (a phone's version of the rail). It sits right under the tab pills.
 * From 1024px the chips wrap into a row. The strip is keyboard-scrollable (it takes focus; Left/Right scroll it) and named.
 * Put <Fact>s inside.
 */
export function FactsStrip({ children, label = "Key facts", className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul aria-label={label} tabIndex={0} className={cn(styles.strip, className)}>
      {children}
    </ul>
  );
}

/** One chip: label, a value (text, a number, a chip), an optional hint. With `href` the whole chip is a link. */
export function Fact({ label, children, hint, tone = "default", href }: { label: string; children: ReactNode; hint?: ReactNode; tone?: keyof typeof TONE; href?: string }) {
  const body = (
    <>
      <span className={styles.stripLabel}>{label}</span>
      <span className={cn(styles.stripValue, TONE[tone])}>{children}</span>
      {hint && <span className={styles.stripHint}>{hint}</span>}
    </>
  );
  return (
    <li className="contents">
      {href ? (
        <Link href={href} className={styles.stripFact}>
          {body}
        </Link>
      ) : (
        <div className={styles.stripFact}>{body}</div>
      )}
    </li>
  );
}
