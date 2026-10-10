"use client";

import type { ReactNode } from "react";

import { useUrlTab } from "./use-url-tab";
import { WorkspacePanel, WorkspaceShell } from "./workspace-shell";
import { WorkspaceTabs, type WorkspaceTab } from "./workspace-tabs";

/**
 * Client-driven tabs for a page whose server component already loads (or streams) every section: pass each section as a
 * ReactNode in `panels` and only the active one is rendered. A tab switch is instant (`?tab=` via `history.pushState`),
 * keeps every other query parameter, and the section cross-fades in. This is recipe B of docs/workspace-pattern.md, packaged.
 *
 *  - `header`   fixed above the tab bar (title, a <KpiStrip>).
 *  - `toolbar`  end of the tab row (a range selector); `toolbars[tab]` overrides it for one tab.
 *  - `rail`     a <StickyRail>; on a phone its facts become a strip above the tabs and its blocks drop below the section.
 */
export function TabbedWorkspace({ idPrefix, label, tabs, panels, header, rail, toolbar, toolbars, fallback, className }: { idPrefix: string; label: string; tabs: WorkspaceTab[]; panels: Record<string, ReactNode>; header?: ReactNode; rail?: ReactNode; toolbar?: ReactNode; toolbars?: Record<string, ReactNode>; fallback?: string; className?: string }) {
  const keys = tabs.map((t) => t.key);
  const { tab, select, hrefFor } = useUrlTab(keys, fallback ?? keys[0]);
  return (
    <WorkspaceShell
      className={className}
      header={header}
      rail={rail}
      hasRail={rail !== undefined}
      toolbar={toolbars?.[tab] ?? toolbar}
      tabs={<WorkspaceTabs tabs={tabs} active={tab} idPrefix={idPrefix} label={label} hrefFor={hrefFor} onSelect={select} />}
    >
      <WorkspacePanel tab={tab} idPrefix={idPrefix}>
        {panels[tab]}
      </WorkspacePanel>
    </WorkspaceShell>
  );
}
