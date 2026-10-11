import { addDays, dayDiff } from "@/lib/marketing/dates";

import type { Delta, ImpactRow } from "./impact";

/** Pure helpers behind the Campaign impact screen: sorting, the comparison period and how a change is worded. */

export type ImpactSortKey = "label" | "spend" | "leads" | "cpl" | "contactedInSlaRate" | "kycRate" | "funded" | "revenue" | "roas";

/** Sorts a copy by one column. Unknown values (null) go last in either direction, never first. */
export function sortImpactRows(rows: ImpactRow[], key: ImpactSortKey, dir: "asc" | "desc"): ImpactRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "label") return sign * a.label.localeCompare(b.label);
    const x = a[key];
    const y = b[key];
    if (x === null && y === null) return a.label.localeCompare(b.label);
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * (x - y) || a.label.localeCompare(b.label);
  });
}

/** The period of the same length that ends the day before this one starts. */
export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const days = dayDiff(range.from, range.to) + 1;
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

export function deltaLabel(d: Delta): { text: string; direction: "up" | "down" | "flat" | "none" } {
  if (d.value === null) return { text: "No figure this period", direction: "none" };
  if (d.change === null) return { text: "No previous figure to compare", direction: "none" };
  const pct = Math.round(d.change * 100);
  if (pct === 0) return { text: "No change vs previous", direction: "flat" };
  return { text: `${pct > 0 ? "+" : ""}${pct}% vs previous`, direction: pct > 0 ? "up" : "down" };
}
