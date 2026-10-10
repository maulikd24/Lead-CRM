import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { AnimatedNumber, type NumberKind } from "./animated-number";
import styles from "./marketing.module.css";

export type RailFact = {
  key: string;
  label: string;
  /** A number counts up; a string is shown as is. */
  value: string | { n: number | null; kind: NumberKind; currency?: string | null };
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive";
  /** A small live pulse next to the label, for a connected feed. */
  live?: boolean;
};

/**
 * The right rail: key facts and actions for the tab on screen. On a wide screen it stays in view beside the panel; on a
 * phone the facts become a swipeable strip above the panel and the blocks drop below it.
 */
export function Rail({ facts, children, actions }: { facts: RailFact[]; children?: ReactNode; actions?: ReactNode }) {
  return (
    <aside aria-label="Key facts and actions" className={styles.rail}>
      <ul className={styles.facts}>
        {facts.map((f, i) => (
          <li key={f.key} className={styles.fact}>
            <Card size="sm" className={cn(styles.enter, styles.lift, "gap-0 py-2")} style={{ ["--i" as string]: i }}>
              <CardContent className="flex flex-col gap-0.5 px-3">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {f.live && <span aria-hidden className={`${styles.liveDot} inline-block size-1.5 rounded-full bg-primary`} />}
                  {f.label}
                </p>
                <p className={cn("font-heading text-lg font-semibold tabular-nums leading-tight", f.tone === "success" && "text-success", f.tone === "warning" && "text-warning", f.tone === "destructive" && "text-destructive")}>
                  {typeof f.value === "string" ? f.value : <AnimatedNumber value={f.value.n} kind={f.value.kind} currency={f.value.currency ?? null} label={f.label} />}
                </p>
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      {(actions || children) && (
        <div className={styles.blocks}>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          {children}
        </div>
      )}
    </aside>
  );
}
