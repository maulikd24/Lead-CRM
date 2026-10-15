"use client";

import { useRef, type KeyboardEvent } from "react";

import { nextTabKey } from "@/components/workspace/tab-logic";
import { cn } from "@/lib/utils";

import styles from "./wow.module.css";

export type ToggleOption = { key: string; label: string };

/** The index the sliding thumb sits on. An unknown value sits on the first option, so the control is never blank. */
export function thumbIndex(options: readonly ToggleOption[], value: string): number {
  const i = options.findIndex((o) => o.key === value);
  return i < 0 ? 0 : i;
}

/** Which option a key moves to: Left/Right and Up/Down step (wrapping), Home/End jump. Null for any other key. */
export function toggleKeyTarget(keys: readonly string[], active: string, key: string): string | null {
  const mapped = key === "ArrowDown" ? "ArrowRight" : key === "ArrowUp" ? "ArrowLeft" : key;
  return nextTabKey(keys, active, mapped);
}

/**
 * A segmented control with a thumb that slides to the chosen option (220ms, one easing curve, no motion under reduced motion).
 * It is a radio group: one tab stop, Left/Right/Home/End move and choose, Space/Enter are not needed because moving chooses.
 * Segments share the width equally, so the thumb needs no measuring and renders correctly on the server.
 */
export function SegmentedToggle({ options, value, onChange, label, className }: { options: readonly ToggleOption[]; value: string; onChange: (key: string) => void; label: string; className?: string }) {
  const group = useRef<HTMLDivElement>(null);
  const keys = options.map((o) => o.key);
  const active = options[thumbIndex(options, value)]?.key;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const next = toggleKeyTarget(keys, active ?? keys[0], e.key);
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    group.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next)}"]`)?.focus();
  };

  return (
    <div ref={group} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn(styles.seg, className)} style={{ ["--n" as string]: options.length, ["--i" as string]: thumbIndex(options, value) }}>
      <span className={styles.segThumb} aria-hidden />
      {options.map((o) => {
        const checked = o.key === active;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={checked} tabIndex={checked ? 0 : -1} data-key={o.key} className={styles.segBtn} onClick={() => onChange(o.key)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
