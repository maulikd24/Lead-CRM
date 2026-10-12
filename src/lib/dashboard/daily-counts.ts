const DAY = 24 * 60 * 60 * 1000;

/** Counts per local day for the last `days` days (oldest first, today last). */
export function dailyCounts(dates: Date[], days: number, now: Date): number[] {
  const end = new Date(now);
  end.setHours(24, 0, 0, 0); // start of tomorrow
  const out = new Array<number>(days).fill(0);
  for (const d of dates) {
    const idx = days - 1 - Math.floor((end.getTime() - d.getTime() - 1) / DAY);
    if (idx >= 0 && idx < days) out[idx] += 1;
  }
  return out;
}
