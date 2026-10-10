import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { panelDomId, tabDomId } from "./tab-logic";
import styles from "./workspace.module.css";

/**
 * The frame of a tabbed workspace page. No endless scroll: a header that stays put (identity, status chips, primary
 * actions), a tab bar, ONE section on screen at a time, and a sticky rail of key facts and the next action.
 *
 * Slots (all optional except `tabs` and `children`):
 *  - `header`   identity, chips, actions.
 *  - `tabs`     a <WorkspaceTabs>. `toolbar` sits at the end of the tab row (a date range, a filter).
 *  - `rail`     a <StickyRail>. On a phone its facts become a strip above the tabs and its actions drop below the section.
 *  - `children` the <WorkspacePanel>. When the panel or rail streams in behind <Suspense>, put both inside `children` and set
 *               `hasRail` (the shell only needs to know the rail exists, to reserve its column).
 *
 * `fill` (default) pins the shell to the viewport on a wide screen and lets the section and rail scroll inside themselves.
 */
export function WorkspaceShell({ header, tabs, toolbar, rail, hasRail, fill = true, children, className }: { header?: ReactNode; tabs: ReactNode; toolbar?: ReactNode; rail?: ReactNode; hasRail?: boolean; fill?: boolean; children: ReactNode; className?: string }) {
  const withRail = hasRail ?? rail !== undefined;
  return (
    <div className={cn(styles.shell, className)} data-fill={fill ? "true" : "false"} data-rail={withRail ? "true" : "false"}>
      {header && <header className={styles.head}>{header}</header>}
      <div className={styles.tabbar}>
        {tabs}
        {toolbar}
      </div>
      {rail}
      {children}
    </div>
  );
}

/**
 * The one visible section. It is a role="tabpanel" labelled by its tab, and it is re-keyed per tab, so it remounts and
 * softly cross-fades in (220ms) every time the tab changes. `busy` marks a loading placeholder (it does not animate, so the real panel is the one that fades in).
 */
export function WorkspacePanel({ tab, idPrefix, busy, className, children }: { tab: string; idPrefix: string; busy?: boolean; className?: string; children: ReactNode }) {
  return (
    <section key={tab} role="tabpanel" id={panelDomId(idPrefix, tab)} aria-labelledby={tabDomId(idPrefix, tab)} aria-busy={busy || undefined} tabIndex={0} className={cn(styles.panelArea, !busy && styles.panel)}>
      <div className={cn(styles.panelStack, className)}>{children}</div>
    </section>
  );
}
