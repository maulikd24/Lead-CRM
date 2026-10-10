"use client";

import { formatCount, formatMoney, formatPercent, formatRatio } from "@/lib/marketing/view-model";

import { useCountUp } from "./use-count-up";

export type NumberKind = "money" | "count" | "percent" | "ratio";

export function formatKind(kind: NumberKind, value: number | null, currency: string | null): string {
  if (kind === "money") return formatMoney(value, currency);
  if (kind === "percent") return formatPercent(value);
  if (kind === "ratio") return formatRatio(value);
  return formatCount(value);
}

/** A number that counts up once on arrival. The animated text is decorative; assistive tech reads the final value once. */
export function AnimatedNumber({ value, kind, currency, label, className }: { value: number | null; kind: NumberKind; currency: string | null; label: string; className?: string }) {
  const shown = useCountUp(value);
  return (
    <>
      <span aria-hidden className={className}>{formatKind(kind, shown, currency)}</span>
      <span className="sr-only">{`${label}: ${formatKind(kind, value, currency)}`}</span>
    </>
  );
}
