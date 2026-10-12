import { formatInrCompact, formatNumber } from "@/lib/utils/format";

export type CountFormat = "number" | "inr" | "inr-compact" | "percent";

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Indian-format display for animated numbers; reuses the shared locale-pinned helpers. */
export function formatCount(value: number, format: CountFormat = "number", decimals = 0): string {
  const v = round(value, decimals);
  const grouped = decimals > 0 ? v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : formatNumber(v);
  switch (format) {
    case "inr":
      return `₹${grouped}`;
    case "inr-compact":
      return formatInrCompact(value);
    case "percent":
      return `${grouped}%`;
    default:
      return grouped;
  }
}
