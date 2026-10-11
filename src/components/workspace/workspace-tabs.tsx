"use client";

import Link from "next/link";
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

import { createTabKeyHandler, panelDomId, tabDirection, tabDomId } from "./tab-logic";
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

  // On a phone the tab row scrolls sideways: keep the active tab in view (scroll the row only, never the page).
  useEffect(() => {
    const row = list.current;
    const el = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2;
  }, [active]);

  // The sliding indicator (from 1024px): the pill and underline glide to the active tab (220ms) instead of jumping. It is positioned
  // straight on the element (no React state), measured on mount, on every tab change and when the row is resized. The first placement
  // is instant; only later moves animate. Without JS the selected tab keeps its own static underline.
  useEffect(() => {
    const row = list.current;
    if (!row) return;
    const place = () => {
      const el = row.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!el) return;
      row.style.setProperty("--ink-x", `${el.offsetLeft}px`);
      row.style.setProperty("--ink-w", `${el.offsetWidth}px`);
      if (!row.dataset.ink) {
        row.dataset.ink = "set";
        requestAnimationFrame(() => requestAnimationFrame(() => { row.dataset.ink = "ready"; }));
      }
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(row);
    return () => ro.disconnect();
  }, [active, tabs.length]);

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

  // Direction-aware: note which way this change travels (set before the new section mounts) so the section can arrive from that side.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-tab-key]");
    if (!target) return;
    const dir = tabDirection(keys, active, target.dataset.tabKey ?? "");
    if (dir === "none") return;
    const root = document.documentElement;
    root.dataset.tabDir = dir;
    // Only this change travels: clear it so a later page load does not slide in from the side.
    window.setTimeout(() => { if (root.dataset.tabDir === dir) delete root.dataset.tabDir; }, 1500);
  };

  return (
    <div ref={list} role="tablist" aria-label={label} aria-orientation="horizontal" className={cn(styles.tabs, className)} onKeyDown={onKeyDown} onClickCapture={onClickCapture}>
      <span className={styles.tabInk} aria-hidden />
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
            {t.count ? <> <span className={styles.tabCount}>{t.count}</span></> : null}
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
