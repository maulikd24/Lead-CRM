"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

import { createTabKeyHandler, panelDomId, tabDomId } from "./tab-logic";
import styles from "./workspace.module.css";

export type WorkspaceTab = {
  key: string;
  label: string;
  /** A small count beside the label (open tickets, drafts...). Hidden when 0 or null. */
  count?: number | null;
  /** The link for this tab. Required when the tab bar is rendered from a server component (functions cannot cross to the client); otherwise `hrefFor` can supply it. */
  href?: string;
};

/**
 * The tab bar: role="tablist" with role="tab" anchors. Each tab is a real link (`href`), so a tab can be opened in a new
 * window, deep-linked and used without JavaScript. Left/Right/Home/End move and select; the active tab is the only tab stop.
 *
 *  - Server-driven (Marketing, Customer 360): leave `onSelect` out; a click is a normal Next link.
 *  - Client-driven (`useUrlTab`): pass `onSelect`; a plain click selects without a server round trip, a modified click (new
 *    tab) still follows the link.
 */
export function WorkspaceTabs({ tabs, active, idPrefix, label, hrefFor, onSelect, className }: { tabs: WorkspaceTab[]; active: string; idPrefix: string; label: string; hrefFor?: (key: string) => string; onSelect?: (key: string) => void; className?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const keys = tabs.map((t) => t.key);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) =>
    createTabKeyHandler({
      keys,
      active,
      focusAndActivate: (key) => {
        const el = list.current?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(key)}"]`);
        el?.focus();
        el?.click();
      },
    })(e);

  return (
    <div ref={list} role="tablist" aria-label={label} aria-orientation="horizontal" className={cn(styles.tabs, className)} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const selected = t.key === active;
        const href = t.href ?? hrefFor?.(t.key) ?? `?tab=${encodeURIComponent(t.key)}`;
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
            <Link key={t.key} href={href} scroll={false} {...common}>
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
          <a key={t.key} href={href} onClick={onClick} {...common}>
            {body}
          </a>
        );
      })}
    </div>
  );
}
