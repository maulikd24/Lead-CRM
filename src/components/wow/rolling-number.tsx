"use client";

import { useEffect, useState } from "react";

import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { cn } from "@/lib/utils";

import { rollDelayMs, splitRolling } from "./rolling-logic";
import styles from "./wow.module.css";

const format = (n: number, prefix: string, suffix: string, decimals: number) =>
  `${prefix}${n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;

const STRIP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * An odometer: each digit sits on a vertical strip of 0 to 9 and rolls to its place once on arrival (under 300ms, staggered). The
 * restyled idea of Cult UI's rolling number (MIT), in our own code and tokens, with no dependency. The server render, the first client
 * render and reduced-motion visitors get the final number resting in place; assistive tech reads the final value once, never the roll.
 */
export function RollingNumber({ value, prefix = "", suffix = "", decimals = 0, label, empty = "—", className }: { value: number | null; prefix?: string; suffix?: string; decimals?: number; label?: string; empty?: string; className?: string }) {
  const reduced = useReducedMotion();
  const [roll, setRoll] = useState(false);
  useEffect(() => {
    if (reduced || value === null) return;
    setRoll(true);
    const t = window.setTimeout(() => setRoll(false), 320);
    return () => window.clearTimeout(t);
  }, [value, reduced]);

  if (value === null || !Number.isFinite(value)) return <span className={className}>{empty}</span>;
  const final = format(value, prefix, suffix, decimals);
  const parts = splitRolling(final);
  return (
    <span className={cn(styles.odo, "tabular-nums", className)} data-roll={roll ? "true" : undefined}>
      <span aria-hidden className={styles.odoRow}>
        {parts.map((p, i) =>
          p.kind === "fixed" ? (
            <span key={i} className={styles.odoFixed}>{p.char}</span>
          ) : (
            <span key={i} className={styles.odoCol}>
              <span className={styles.odoStrip} style={{ ["--d" as string]: p.digit, ["--delay" as string]: `${rollDelayMs(i, parts.length)}ms` }}>
                {STRIP.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </span>
          ),
        )}
      </span>
      <span className="sr-only">{label ? `${label}: ${final}` : final}</span>
    </span>
  );
}
