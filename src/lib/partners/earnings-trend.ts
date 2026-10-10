import { computeDelta, type Delta } from "@/components/wow/wow-logic";

type Month = { period: string; earnings: number };

const key = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;

/**
 * What the partner overview's earnings figure shows: the running total by month (a real sparkline) and how the last full month
 * compares with the month before it. The month in progress is left out of the comparison, so a half-finished month never reads as a fall.
 */
export function earningsTrend(monthly: readonly Month[], now: Date): { cumulative: number[]; delta: Delta | null } {
  let total = 0;
  const cumulative = monthly.map((m) => (total += m.earnings));
  const at = (back: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return key(d.getUTCFullYear(), d.getUTCMonth());
  };
  const lastKey = at(1);
  const prevKey = at(2);
  const a = monthly.find((m) => m.period === lastKey);
  const b = monthly.find((m) => m.period === prevKey);
  return { cumulative, delta: a && b ? computeDelta(a.earnings, b.earnings) : null };
}
