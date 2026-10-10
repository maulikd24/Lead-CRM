"use client";

import { CountUp } from "@/components/workspace";
import { formatCount, formatMoney, formatPercent, formatRatio } from "@/lib/marketing/view-model";

export type NumberKind = "money" | "count" | "percent" | "ratio";

export function formatKind(kind: NumberKind, value: number | null, currency: string | null): string {
  if (kind === "money") return formatMoney(value, currency);
  if (kind === "percent") return formatPercent(value);
  if (kind === "ratio") return formatRatio(value);
  return formatCount(value);
}

/** A number that counts up once on arrival (the shared workspace CountUp, with Marketing's number formats). */
export function AnimatedNumber({ value, kind, currency, label, className }: { value: number | null; kind: NumberKind; currency: string | null; label: string; className?: string }) {
  if (value === null) return <span className={className}>{formatKind(kind, null, currency)}</span>;
  return <CountUp value={value} format={(n) => formatKind(kind, n, currency)} label={label} className={className} />;
}
