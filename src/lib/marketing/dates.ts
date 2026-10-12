/** Calendar-day helpers on "YYYY-MM-DD" strings. Ad platforms report days in the ad account's timezone, so "today" must be too. */

export function todayInTimeZone(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function dateToYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToYmd(d);
}

export function dayDiff(from: string, to: string): number {
  return Math.round((ymdToDate(to).getTime() - ymdToDate(from).getTime()) / 86_400_000);
}

export type DateWindow = { since: string; until: string };

/** Splits an inclusive range into consecutive windows of at most `size` days, oldest first. */
export function buildWindows(since: string, until: string, size: number): DateWindow[] {
  const out: DateWindow[] = [];
  for (let start = since; start <= until; start = addDays(start, size)) {
    const end = addDays(start, size - 1);
    out.push({ since: start, until: end < until ? end : until });
  }
  return out;
}
