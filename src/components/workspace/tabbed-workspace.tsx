"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition, type ReactNode } from "react";

import { needsServerTrip } from "./lazy-panels";
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
 *  - `lazy`     the page sent only the section for `?tab=` (see lazy-panels.ts), so the queries behind the other tabs never ran. Choosing a
 *               tab that was not sent is a normal navigation (router.push, so history and deep links work); the current section stays on
 *               screen until the next one is ready.
 */
export function TabbedWorkspace({ idPrefix, label, tabs, panels, header, rail, toolbar, toolbars, fallback, lazy = false, className }: { idPrefix: string; label: string; tabs: WorkspaceTab[]; panels: Record<string, ReactNode>; header?: ReactNode; rail?: ReactNode; toolbar?: ReactNode; toolbars?: Record<string, ReactNode>; fallback?: string; lazy?: boolean; className?: string }) {
  const keys = tabs.map((t) => t.key);
  const { tab, select: pushTab, hrefFor } = useUrlTab(keys, fallback ?? keys[0]);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const select = useCallback(
    (key: string) => {
      if (key === tab) return;
      if (needsServerTrip(lazy, panels, key)) startTransition(() => router.push(hrefFor(key), { scroll: false }));
      else pushTab(key);
    },
    [lazy, panels, tab, router, hrefFor, pushTab],
  );
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
