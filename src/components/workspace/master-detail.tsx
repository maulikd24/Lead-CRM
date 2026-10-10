"use client";

import { ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import styles from "./density.module.css";
import wsStyles from "./workspace.module.css";
import { nextItemId, resolveSelected } from "./master-detail-logic";
import { Sheet, useUrlSheet } from "./sheet";
import { splitShowFirst, viewAllLabel } from "./show-first-logic";

export type MasterItem = {
  id: string;
  /** One line: the name of the thing. */
  title: ReactNode;
  /** A second, quieter line (a date, a count). */
  meta?: ReactNode;
  /** Right edge: a chip or a number. */
  trailing?: ReactNode;
};

/**
 * Master-detail: a compact list on the left with keyboard Up/Down (Home/End), the selected item's full detail on the right, each
 * scrolling inside its own panel, so the page itself never scrolls. The selection lives in `?item=` (replaceState: no history spam).
 *
 * Phone: the list shows its top 5 ("View all (n)" opens a bottom sheet with the rest) and choosing an item opens its detail in a
 * full-height sheet. `details` maps each item id to its detail node; only the selected one is rendered.
 */
export function MasterDetail({ idPrefix, label, items, details, param = "item", emptyDetail, limit = 5, noun, className }: { idPrefix: string; label: string; items: MasterItem[]; details: Record<string, ReactNode>; param?: string; emptyDetail?: ReactNode; limit?: number; noun?: string; className?: string }) {
  const search = useSearchParams();
  const ids = items.map((i) => i.id);
  const selected = resolveSelected(ids, search?.get(param));
  const detailSheet = useUrlSheet(`${idPrefix}-detail`);
  const allSheet = useUrlSheet(`${idPrefix}-all`);
  const listRef = useRef<HTMLUListElement>(null);

  const select = useCallback(
    (id: string) => {
      const q = new URLSearchParams(window.location.search);
      q.set(param, id);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${q.toString()}`);
    },
    [param],
  );

  /** A tap or Enter: select, and on a phone open the detail sheet. */
  const pick = useCallback(
    (id: string) => {
      select(id);
      if (window.matchMedia("(max-width: 1023.98px)").matches) {
        const q = new URLSearchParams(window.location.search);
        q.set(param, id);
        q.set("sheet", `${idPrefix}-detail`);
        // From the "all" sheet this swaps one sheet for the other without adding history.
        if (allSheet.open) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${q.toString()}`);
        else detailSheet.show();
      }
    },
    [select, param, idPrefix, allSheet.open, detailSheet],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey || !selected) return;
    const target = nextItemId(ids, selected, e.key);
    if (target === null) return;
    e.preventDefault();
    select(target);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(target)}"]`)?.focus());
  };

  const { needsViewAll } = splitShowFirst(items.length, limit);
  const selectedItem = items.find((i) => i.id === selected);
  const optionId = (id: string) => `${idPrefix}-opt-${id}`;

  const renderOption = (item: MasterItem, opts: { pickFn: (id: string) => void; withTabStop: boolean; liClassName?: string }) => (
    <li key={item.id} role="presentation" className={opts.liClassName}>
      <button
        type="button"
        role="option"
        id={opts.withTabStop ? optionId(item.id) : undefined}
        data-item-id={item.id}
        aria-selected={item.id === selected}
        tabIndex={!opts.withTabStop || item.id === selected ? 0 : -1}
        className={styles.mdOption}
        onClick={() => opts.pickFn(item.id)}
      >
        <span className={styles.mdText}>
          <span className={styles.mdTitle}>{item.title}</span>
          {item.meta && <span className={styles.mdMeta}>{item.meta}</span>}
        </span>
        <span className={cn(styles.mdTrail, "flex items-center gap-1")}>
          {item.trailing}
          <ChevronRight className="size-4 text-muted-foreground lg:hidden" aria-hidden />
        </span>
      </button>
    </li>
  );

  return (
    <div className={cn(styles.md, className)}>
      <div className={styles.mdListPane}>
        <ul ref={listRef} role="listbox" aria-label={label} aria-orientation="vertical" onKeyDown={onKeyDown} className={styles.mdList}>
          {items.map((item, i) => renderOption(item, { pickFn: pick, withTabStop: true, liClassName: i >= limit ? styles.overflowItem : undefined }))}
        </ul>
        {needsViewAll && (
          <>
            <button type="button" className={styles.viewAll} aria-haspopup="dialog" aria-expanded={allSheet.open} onClick={allSheet.show}>
              {viewAllLabel(items.length, noun)}
              <ChevronRight className="size-4" aria-hidden />
            </button>
            <Sheet name={`${idPrefix}-all`} open={allSheet.open} onClose={allSheet.hide} title={label}>
              <ul role="listbox" aria-label={label} className={styles.mdSheetList}>
                {items.map((item) => renderOption(item, { pickFn: pick, withTabStop: false }))}
              </ul>
            </Sheet>
          </>
        )}
      </div>

      <section key={selected ?? "none"} aria-label={`${label}: details`} tabIndex={0} className={cn(styles.mdDetail, wsStyles.panel)}>
        {selected ? details[selected] : emptyDetail}
      </section>

      <Sheet name={`${idPrefix}-detail`} open={detailSheet.open} onClose={detailSheet.hide} title={selectedItem ? String(typeof selectedItem.title === "string" ? selectedItem.title : label) : label}>
        {selected ? details[selected] : emptyDetail}
      </Sheet>
    </div>
  );
}
