// Count-up maths, kept pure so the hook (src/components/c360/use-count-up.ts) is a thin timer around it and can be
// swapped for the shared motion toolkit later.

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function easeOutCubic(t: number): number {
  const p = clamp01(t);
  return 1 - (1 - p) ** 3;
}

export function countUpValue(from: number, to: number, progress: number, decimals = 0): number {
  if (!Number.isFinite(to) || !Number.isFinite(from)) return 0;
  const p = clamp01(progress);
  const factor = 10 ** decimals;
  if (p >= 1) return Math.round(to * factor) / factor;
  return Math.round((from + (to - from) * easeOutCubic(p)) * factor) / factor;
}

/** Indian digit grouping with lakh / crore for large amounts. */
export function formatInrCompact(value: number): string {
  if (!Number.isFinite(value)) return "₹0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
