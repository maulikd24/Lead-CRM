import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { motion } from "./motion-classes";
import styles from "./workspace.module.css";

/**
 * The right rail: key facts and the next action, kept in view beside the section on a wide screen. On a phone the facts
 * become a swipeable strip above the tab bar and `actions` / `children` drop below the section.
 *
 * `facts` is a list of <RailFact>. `actions` is a row of buttons. `children` are <RailCard> blocks.
 */
export function StickyRail({ facts, actions, children, label = "Key facts and actions" }: { facts?: ReactNode; actions?: ReactNode; children?: ReactNode; label?: string }) {
  return (
    <aside aria-label={label} className={styles.rail}>
      {facts && <ul className={styles.facts} aria-label="Key facts" tabIndex={0}>{facts}</ul>}
      {(actions || children) && (
        <div className={styles.blocks}>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          {children}
        </div>
      )}
    </aside>
  );
}

const TONE = { default: "", success: "text-success", warning: "text-warning", destructive: "text-destructive" } as const;

/** One compact fact: label, a value (any node: text, a <CountUp>, a chip), an optional hint. `index` staggers the entrance. */
export function RailFact({ label, children, hint, tone = "default", live, index = 0 }: { label: string; children: ReactNode; hint?: ReactNode; tone?: keyof typeof TONE; live?: boolean; index?: number }) {
  return (
    <li className={styles.fact}>
      <Card size="sm" className={cn(motion.enter, motion.lift, "gap-0 py-1.5 lg:py-2")} style={{ ["--i" as string]: index }}>
        <CardContent className="flex flex-col gap-0 px-3 lg:gap-0.5">
          <p className="flex items-center gap-1.5 truncate text-[0.6875rem] text-muted-foreground lg:text-xs">
            {live && <span aria-hidden className={cn(motion.liveDot, "inline-block size-1.5 rounded-full bg-primary")} />}
            {label}
          </p>
          <div className={cn("font-heading text-base font-semibold leading-tight tabular-nums lg:text-lg", TONE[tone])}>{children}</div>
          {hint && <p className="truncate text-[0.6875rem] text-muted-foreground lg:text-xs">{hint}</p>}
        </CardContent>
      </Card>
    </li>
  );
}

/** A larger rail block with a title (a ring, a next-step card, a short list). Labelled region, entrance and hover lift included. */
export function RailCard({ title, labelId, icon: Icon, children, className, index = 0 }: { title: string; labelId: string; icon?: React.ComponentType<{ className?: string }>; children: ReactNode; className?: string; index?: number }) {
  return (
    <Card size="sm" role="region" aria-labelledby={labelId} className={cn(motion.enter, className)} style={{ ["--i" as string]: index }}>
      <CardHeader>
        <CardTitle id={labelId} className="flex items-center gap-2 text-sm">
          {Icon && <Icon className="size-4 text-muted-foreground" />}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
