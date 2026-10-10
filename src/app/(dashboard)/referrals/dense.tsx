"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { nextItem, pickSelected, viewAllLabel } from "./dense-logic";
import styles from "./dense.module.css";

/** A bottom sheet for a phone: the content scrolls inside it, the page behind does not. */
export function PhoneSheet({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] gap-0 rounded-t-2xl p-0 lg:hidden">
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export type DenseBadge = { label: string; variant: "success" | "warning" | "outline" | "secondary" | "destructive" };
/** Plain data on purpose: it crosses from a server component and stays light. */
export type DenseItem = { id: string; title: string; meta?: string; amount?: string; badges?: DenseBadge[] };

function Options({ items, selected, onPick, label, idPrefix, hideFrom }: { items: DenseItem[]; selected: string | null; onPick: (id: string) => void; label: string; idPrefix: string; hideFrom?: number }) {
  const ref = useRef<HTMLUListElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey || !selected) return;
    const target = nextItem(items.map((i) => i.id), selected, e.key);
    if (target === null) return;
    e.preventDefault();
    onPick(target);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(target)}"]`)?.focus());
  };
  return (
    <ul ref={ref} role="listbox" aria-label={label} className="m-0 flex list-none flex-col p-0" onKeyDown={onKeyDown}>
      {items.map((item, i) => (
        <li key={item.id} role="presentation" className={cn(hideFrom !== undefined && i >= hideFrom && "max-lg:hidden")}>
          <button type="button" role="option" id={`${idPrefix}-opt-${item.id}`} data-item-id={item.id} aria-selected={item.id === selected} tabIndex={item.id === selected ? 0 : -1} className={styles.option} onClick={() => onPick(item.id)}>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{item.title}</span>
              {item.meta && <span className="block truncate text-xs text-muted-foreground">{item.meta}</span>}
            </span>
            {(item.amount || (item.badges && item.badges.length > 0)) && (
              <span className="flex flex-none flex-col items-end gap-1 text-right text-xs">
                {item.amount && <span className="font-medium tabular-nums">{item.amount}</span>}
                {item.badges?.map((b) => (
                  <Badge key={b.label} variant={b.variant}>
                    {b.label}
                  </Badge>
                ))}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A list with a detail. Laptop: two panes, each scrolling inside itself, so the page never scrolls; Up/Down/Home/End move the
 * selection. Phone: the top `limit` (5) items, "View all (n)" opens the rest in a bottom sheet, and choosing an item opens its
 * detail in a bottom sheet. The selection is kept in `?item=` (replaceState, no history spam).
 */
export function MasterDetail({ idPrefix, label, noun, items, details, initial, limit = 5, empty, before, after }: { idPrefix: string; label: string; noun: string; items: DenseItem[]; details: Record<string, ReactNode>; initial?: string | null; limit?: number; empty?: ReactNode; /** A line above the panes (a status note). */ before?: ReactNode; /** A line below the panes (a footnote). */ after?: ReactNode }) {
  const ids = items.map((i) => i.id);
  const [selected, setSelected] = useState<string | null>(() => pickSelected(ids, initial));
  const [detailOpen, setDetailOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const choose = useCallback((id: string) => {
    setSelected(id);
    const q = new URLSearchParams(window.location.search);
    q.set("item", id);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${q.toString()}`);
  }, []);
  const pick = useCallback(
    (id: string) => {
      choose(id);
      if (window.matchMedia("(max-width: 1023.98px)").matches) {
        setAllOpen(false);
        setDetailOpen(true);
      }
    },
    [choose],
  );
  if (items.length === 0) return <div className={styles.fill}>{empty}</div>;
  const current = selected ? items.find((i) => i.id === selected) : undefined;
  return (
    <div className={cn(styles.fill, "flex flex-col gap-3")}>
      {before ? <Fragment key="before">{before}</Fragment> : null}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:overflow-y-auto">
        <Options items={items} selected={selected} onPick={pick} label={label} idPrefix={idPrefix} hideFrom={limit} />
        {items.length > limit && (
          <button type="button" className="flex min-h-11 items-center justify-center gap-1 border-t border-border text-sm font-medium text-primary lg:hidden" aria-haspopup="dialog" onClick={() => setAllOpen(true)}>
            {viewAllLabel(items.length, noun)}
            <ChevronRight className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <section aria-label={`${label}: details`} className="hidden min-h-0 overflow-y-auto rounded-xl border border-border bg-card p-4 lg:block" tabIndex={0}>
        {!detailOpen && selected ? <div key={selected}>{details[selected]}</div> : null}
      </section>
      </div>
      {after ? <Fragment key="after">{after}</Fragment> : null}
      <PhoneSheet open={allOpen} onOpenChange={setAllOpen} title={label} description={`${items.length} ${noun}`}>
        <div className="-m-4">
          <Options items={items} selected={selected} onPick={pick} label={`All ${label}`} idPrefix={`${idPrefix}-all`} />
        </div>
      </PhoneSheet>
      <PhoneSheet open={detailOpen} onOpenChange={setDetailOpen} title={current?.title ?? label}>
        {selected ? <div key={selected}>{details[selected]}</div> : null}
      </PhoneSheet>
    </div>
  );
}

/**
 * Something too big for a phone's first screen (a form, a long card) becomes one dense row that opens it in a bottom sheet.
 * From 1024px the children simply show in place.
 */
export function PhoneRow({ title, summary, badge, children }: { title: string; summary?: ReactNode; badge?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="lg:hidden">
        <button type="button" className={styles.row} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{title}</span>
            {summary && <span className="block truncate text-xs text-muted-foreground">{summary}</span>}
          </span>
          <span className="flex flex-none items-center gap-1">
            {badge}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </span>
        </button>
      </div>
      <div className="hidden lg:contents">{open ? null : children}</div>
      <PhoneSheet open={open} onOpenChange={setOpen} title={title}>
        {children}
      </PhoneSheet>
    </>
  );
}

/** The page's primary actions as a bar within thumb reach on a phone. Nothing on a laptop (the same actions are in the header there). */
export function StickyBar({ children, label = "Primary actions" }: { children: ReactNode; label?: string }) {
  return (
    <>
      <div className={styles.barSpacer} aria-hidden />
      <div role="group" aria-label={label} className={styles.bar}>
        {children}
      </div>
    </>
  );
}

/** A button that opens a bottom sheet (phone) holding a form or a list; used for "Add ..." in the action bar. */
export function SheetButton({ label, title, description, variant = "default", children }: { label: string; title: string; description?: string; variant?: "default" | "outline"; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <PhoneSheet open={open} onOpenChange={setOpen} title={title} description={description}>
        {children}
      </PhoneSheet>
    </>
  );
}
