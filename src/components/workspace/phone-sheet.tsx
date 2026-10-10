"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import styles from "./density.module.css";
import { Sheet, useInlineHiddenWhileOpen, useUrlSheet } from "./sheet";
import { sheetDomId } from "./sheet-logic";
import { viewAllLabel } from "./show-first-logic";

/**
 * Something too big for a phone's first screen (a details card, a form, a long panel) becomes ONE dense row: a title and a one-line
 * summary. Tapping it opens the full content in a bottom sheet (URL-synced `?sheet=<name>`; Back and Esc close it).
 * From 1024px the children simply show in place, so nothing is lost on a laptop. `name` must be unique on the page.
 */
export function PhoneSheet({ name, title, summary, badge, description, footer, children }: { name: string; title: string; summary?: ReactNode; badge?: ReactNode; description?: string; footer?: ReactNode; children: ReactNode }) {
  const { open, show, hide } = useUrlSheet(name);
  const hideInline = useInlineHiddenWhileOpen(open);
  return (
    <>
      <div className={styles.phoneOnly}>
        <button type="button" className={styles.row} aria-haspopup="dialog" aria-expanded={open} aria-controls={sheetDomId(name)} onClick={show}>
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>{title}</span>
            {summary && <span className={styles.rowSummary}>{summary}</span>}
          </span>
          <span className={`${styles.rowBadge} flex items-center gap-1`}>
            {badge}
            <ChevronRight className="size-4" aria-hidden />
          </span>
        </button>
      </div>
      <div className={styles.laptopOnly}>{hideInline ? null : children}</div>
      <Sheet name={name} open={open} onClose={hide} title={title} description={description} footer={footer}>
        {children}
      </Sheet>
    </>
  );
}

/**
 * A list rendered twice, once per screen size: `preview` (the top rows) on a phone with "View all (n)" opening `full` in a sheet, and
 * `full` in place from 1024px. Use it when the list is one component that takes the rows as a prop (a timeline, a table).
 */
export function ShowFirstBlock({ name, title, total, noun, preview, full, description, limit = 5 }: { name: string; title: string; total: number; noun?: string; preview: ReactNode; full: ReactNode; description?: string; limit?: number }) {
  const { open, show, hide } = useUrlSheet(name);
  const hideInline = useInlineHiddenWhileOpen(open);
  return (
    <>
      <div className={styles.phoneOnly}>
        {preview}
        {total > limit && (
        <button type="button" className={styles.viewAll} aria-haspopup="dialog" aria-expanded={open} aria-controls={sheetDomId(name)} onClick={show}>
          {viewAllLabel(total, noun)}
          <ChevronRight className="size-4" aria-hidden />
        </button>
        )}
      </div>
      <div className={styles.laptopOnly}>{hideInline ? null : full}</div>
      {total > limit && (
        <Sheet name={name} open={open} onClose={hide} title={title} description={description}>
          {full}
        </Sheet>
      )}
    </>
  );
}
