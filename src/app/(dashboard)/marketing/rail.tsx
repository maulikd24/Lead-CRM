import type { ReactNode } from "react";

import { RailFact as Fact, StickyRail } from "@/components/workspace";

import { AnimatedNumber, type NumberKind } from "./animated-number";

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
 * phone the facts become a swipeable strip above the tabs and the blocks drop below the section.
 */
export function Rail({ facts, children, actions }: { facts: RailFact[]; children?: ReactNode; actions?: ReactNode }) {
  return (
    <StickyRail
      facts={facts.map((f, i) => (
        <Fact key={f.key} label={f.label} hint={f.hint} tone={f.tone} live={f.live} index={i}>
          {typeof f.value === "string" ? f.value : <AnimatedNumber value={f.value.n} kind={f.value.kind} currency={f.value.currency ?? null} label={f.label} />}
        </Fact>
      ))}
      actions={actions}
    >
      {children}
    </StickyRail>
  );
}
