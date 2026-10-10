"use client";

import { cn } from "@/lib/utils";

import { useCountUp } from "./use-count-up";

const defaultFormat = (n: number) => Math.round(n).toLocaleString("en-IN");

/** Serializable formatting for server components, which cannot pass `format` (a function) to this client component. */
const affixed = (prefix: string, suffix: string, decimals: number) => (n: number) => `${prefix}${n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;

/**
 * A number that counts up once on arrival (300ms). The animated text is decorative; assistive tech reads the final value
 * once, and so does anyone who asked for reduced motion. `format` turns a number into text (money, percent, ratio...); server components pass `prefix`, `suffix` and `decimals` instead.
 * Pass `value={null}` for "no data": `empty` is shown instead and nothing animates.
 */
export function CountUp({ value, format, prefix = "", suffix = "", decimals = 0, label, empty = "—", className }: { value: number | null; format?: (n: number) => string; prefix?: string; suffix?: string; decimals?: number; label?: string; empty?: string; className?: string }) {
  const shown = useCountUp(value);
  format ??= prefix || suffix || decimals ? affixed(prefix, suffix, decimals) : defaultFormat;
  if (value === null || !Number.isFinite(value)) return <span className={className}>{empty}</span>;
  const final = format(value);
  return (
    <span className={cn("tabular-nums", className)}>
      <span aria-hidden>{shown === null ? final : format(shown)}</span>
      <span className="sr-only">{label ? `${label}: ${final}` : final}</span>
    </span>
  );
}
