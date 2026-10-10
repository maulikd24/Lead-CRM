"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

import styles from "./density.module.css";
import { parseSheetParam, SHEET_STATE_KEY, shouldGoBack, sheetDomId, sheetHref } from "./sheet-logic";

/**
 * A full-height bottom sheet on a phone, a side drawer from 1024px. Built on the native modal <dialog>, so it is a real dialog
 * (role, aria-modal, everything behind it inert, focus trapped and returned to the trigger on close, Esc closes) with no dependency.
 * It slides in once (260ms; instant under reduced motion). Content mounts only while it is open.
 *
 * Controlled: `open` and `onClose`. Most pages want `useUrlSheet` (below), which keeps the open sheet in `?sheet=` so it can be
 * deep-linked and the browser Back button closes it.
 */
export function Sheet({ open, onClose, title, description, name, footer, children, className }: { open: boolean; onClose: () => void; title: string; description?: string; name: string; footer?: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      closeRef.current?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  // The page behind a sheet must not scroll with it.
  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      id={sheetDomId(name)}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={cn(styles.sheet, className)}
      onCancel={(e) => {
        // Esc: let our state close it (so the URL stays in step), not the browser.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="flex justify-center" aria-hidden>
            <span className={styles.sheetGrab} />
          </div>
          <div className={styles.sheetHead}>
            <div className="min-w-0">
              <h2 id={titleId} className={styles.sheetTitle}>
                {title}
              </h2>
              {description && (
                <p id={descId} className={styles.sheetDesc}>
                  {description}
                </p>
              )}
            </div>
            <button ref={closeRef} type="button" className={styles.sheetClose} onClick={onClose} aria-label={`Close ${title}`}>
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className={styles.sheetBody} tabIndex={0}>
            {children}
          </div>
          {footer && <div className={styles.sheetFoot}>{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/**
 * Sheet state kept in the URL (`?sheet=<name>`): deep-linkable, and Back closes it. Opening pushes a history entry (marked, so we know
 * it is ours); closing steps Back when that entry is ours, and otherwise (a deep link) rewrites the URL in place.
 */
export function useUrlSheet(name: string) {
  const search = useSearchParams();
  const pathname = usePathname() ?? "";
  const open = parseSheetParam(search?.get("sheet")) === name;

  const show = useCallback(() => {
    window.history.pushState({ [SHEET_STATE_KEY]: name }, "", sheetHref(pathname, window.location.search, name));
  }, [pathname, name]);

  const hide = useCallback(() => {
    if (shouldGoBack(window.history.state, name)) window.history.back();
    else window.history.replaceState(window.history.state, "", sheetHref(pathname, window.location.search, null));
  }, [pathname, name]);

  return { open, show, hide };
}

/**
 * A URL-synced sheet with its own trigger: put a secondary form, a long list or a detail behind a button. `trigger` is the button's
 * content; pass `triggerClassName` or use `render` to style it.
 */
export function UrlSheet({ name, title, description, trigger, footer, children, triggerClassName, triggerProps }: { name: string; title: string; description?: string; trigger: ReactNode; footer?: ReactNode; children: ReactNode; triggerClassName?: string; triggerProps?: Record<string, unknown> }) {
  const { open, show, hide } = useUrlSheet(name);
  return (
    <>
      <button type="button" className={triggerClassName} aria-haspopup="dialog" aria-expanded={open} aria-controls={sheetDomId(name)} onClick={show} {...triggerProps}>
        {trigger}
      </button>
      <Sheet name={name} open={open} onClose={hide} title={title} description={description} footer={footer}>
        {children}
      </Sheet>
    </>
  );
}

/**
 * True while a sheet is open on a phone. The laptop copy of the content (hidden by CSS on a phone) is left out then, so a form that
 * lives in the sheet exists exactly once and its labels and ids point at the right field.
 */
export function useInlineHiddenWhileOpen(open: boolean): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    setPhone(open && window.matchMedia("(max-width: 1023.98px)").matches);
  }, [open]);
  return open && phone;
}
