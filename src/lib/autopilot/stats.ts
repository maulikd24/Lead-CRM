/** Small, pure statistics helpers. No randomness, no clock. */

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** a / b, or null when b is 0 (never NaN or Infinity: an empty denominator is "no answer", not zero). */
export function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Linear-interpolated percentile, p in 0..1. */
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = (s.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/** z for the two-sided confidence levels used here. */
const Z: Record<number, number> = { 0.8: 1.2816, 0.9: 1.6449, 0.95: 1.96 };

/** Wilson score interval for a proportion: honest with small counts, never leaves 0..1. */
export function wilson(successes: number, n: number, level: 0.8 | 0.9 | 0.95 = 0.9): { low: number; high: number } | null {
  if (n <= 0) return null;
  const z = Z[level];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export const round = (x: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Indian-style rupee text, whole rupees: 1,23,456. */
export function inr(x: number): string {
  return "₹" + Math.round(x).toLocaleString("en-IN");
}
export const pct = (x: number, digits = 0) => `${round(x * 100, digits)}%`;
