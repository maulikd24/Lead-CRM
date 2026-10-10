"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import styles from "./density.module.css";
import { Sheet, useUrlSheet } from "./sheet";
import { sheetDomId } from "./sheet-logic";
import { splitShowFirst, viewAllLabel } from "./show-first-logic";

/**
 * A list that shows its top rows and tucks the rest behind "View all (n)".
 *
 * On a phone only the first `limit` (default 5) rows show; "View all (n)" opens a full-height bottom sheet with every row (URL-synced
 * as `?sheet=<name>`, so Back and Esc close it). From 1024px every row shows in the page's own scrolling panel and the button is
 * hidden: the sheet exists only where the screen is too small for the list.
 *
 * `flush` removes the gap between rows (rows that draw their own dividers). `items` are the rows (any nodes). `name` must be unique on the page. `total` overrides the number on the button when the page
 * only loaded the first page of a longer list. `sheetItems` lets the sheet show a fuller rendering than the inline rows.
 */
export function ShowFirst({ name, title, items, limit = 5, total, noun, sheetItems, description, as = "ul", flush, className, sheetClassName }: { name: string; title: string; items: ReactNode[]; limit?: number; total?: number; noun?: string; sheetItems?: ReactNode[]; description?: string; as?: "ul" | "div"; flush?: boolean; className?: string; sheetClassName?: string }) {
  const { open, show, hide } = useUrlSheet(name);
  const count = total ?? items.length;
  const { needsViewAll } = splitShowFirst(count, limit);
  const List = as;
  const Row = as === "ul" ? "li" : "div";
  const all = sheetItems ?? items;
  return (
    <>
      <List className={cn(styles.list, className)} data-flush={flush || undefined} aria-label={title}>
        {items.map((item, i) => (
          <Row key={i} className={i >= limit ? styles.overflowItem : undefined}>
            {item}
          </Row>
        ))}
      </List>
      {needsViewAll && (
        <>
          <button type="button" className={styles.viewAll} aria-haspopup="dialog" aria-expanded={open} aria-controls={sheetDomId(name)} onClick={show}>
            {viewAllLabel(count, noun)}
            <ChevronRight className="size-4" aria-hidden />
          </button>
          <Sheet name={name} open={open} onClose={hide} title={title} description={description}>
            <List className={cn(styles.sheetList, sheetClassName)} data-flush={flush || undefined} aria-label={title}>
              {all.map((item, i) => (
                <Row key={i}>{item}</Row>
              ))}
            </List>
          </Sheet>
        </>
      )}
    </>
  );
}
