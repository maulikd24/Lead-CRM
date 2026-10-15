/** Pure bucketing helpers behind every sparkline and trend chart. No database, no clock. */

/** A running total on top of `base` (what existed before the window). */
export function cumulative(base: number, perDay: readonly number[]): number[] {
  let total = base;
  return perDay.map((n) => (total += n));
}

/** Rows per bucket of `bucketMs`, starting at `start`. A row outside the window is ignored. */
export function bucketCounts(dates: readonly Date[], start: Date, bucketMs: number, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const at of dates) {
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) continue;
    const i = Math.floor((at.getTime() - start.getTime()) / bucketMs);
    if (i >= 0 && i < n) out[i] += 1;
  }
  return out;
}

export function bucketSums(rows: readonly { at: Date; value: number }[], start: Date, bucketMs: number, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const r of rows) {
    if (!(r.at instanceof Date) || Number.isNaN(r.at.getTime())) continue;
    const i = Math.floor((r.at.getTime() - start.getTime()) / bucketMs);
    if (i >= 0 && i < n) out[i] += r.value;
  }
  return out;
}

/** The start of the window of the same length that ends where a window starting at `start` begins. */
export function previousWindow(start: Date, windowMs: number): Date {
  return new Date(start.getTime() - windowMs);
}

const DAY = 86_400_000;

const MAX_BUCKETS = 30;

/** How many buckets a period gets, and how long each is: a day each up to 30 days, then equal chunks of whole days. */
export function periodBuckets(from: Date, to: Date): { n: number; bucketMs: number } {
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY));
  const per = Math.ceil(days / MAX_BUCKETS);
  return { n: Math.ceil(days / per), bucketMs: per * DAY };
}
