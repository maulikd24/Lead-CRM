"use client";

import Link from "next/link";
import { useRef, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

import { createTabKeyHandler, panelDomId, tabDomId } from "./tab-logic";
import styles from "./workspace.module.css";

export type WorkspaceTab = { key: string; label: string; /** A small count beside the label (open tickets, drafts...). Hidden when 0 or null. */ count?: number | null };

/**
 * The tab bar: role="tablist" with role="tab" anchors. Each tab is a real link (`hrefFor`), so a tab can be opened in a new
 * window, deep-linked and used without JavaScript. Left/Right/Home/End move and select; the active tab is the only tab stop.
 *
 *  - Server-driven (Marketing, Customer 360): leave `onSelect` out; a click is a normal Next link.
 *  - Client-driven (`useUrlTab`): pass `onSelect`; a plain click selects without a server round trip, a modified click (new
 *    tab) still follows the link.
 */
export function WorkspaceTabs({ tabs, active, idPrefix, label, hrefFor, onSelect, className }: { tabs: WorkspaceTab[]; active: string; idPrefix: string; label: string; hrefFor: (key: string) => string; onSelect?: (key: string) => void; className?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const keys = tabs.map((t) => t.key);

  const focusAndActivate = (key: string) => {
    const el = list.current?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(key)}"]`);
    el?.focus();
    el?.click();
  };
  const onKeyDown = createTabKeyHandler({ keys, active, focusAndActivate });

  return (
    <div ref={list} role="tablist" aria-label={label} aria-orientation="horizontal" className={cn(styles.tabs, className)} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const selected = t.key === active;
        const common = {
          role: "tab" as const,
          id: tabDomId(idPrefix, t.key),
          "aria-selected": selected,
          "aria-controls": panelDomId(idPrefix, t.key),
          tabIndex: selected ? 0 : -1,
          "data-tab-key": t.key,
          className: styles.tab,
        };
        const body = (
          <>
            {t.label}
            {t.count ? <span className={styles.tabCount}>{t.count}</span> : null}
          </>
        );
        if (!onSelect) {
          return (
            <Link key={t.key} href={hrefFor(t.key)} scroll={false} {...common}>
              {body}
            </Link>
          );
        }
        const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
          if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onSelect(t.key);
        };
        return (
          <a key={t.key} href={hrefFor(t.key)} onClick={onClick} {...common}>
            {body}
          </a>
        );
      })}
    </div>
  );
}
