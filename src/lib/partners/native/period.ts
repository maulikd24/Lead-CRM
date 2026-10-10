import { paiseToNumber, parseUnits, roundToPaise } from "./money";

/** Calendar months in India (UTC+5:30, no daylight saving), expressed as UTC instants. Pure. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function istParts(at: Date) {
  const local = new Date(at.getTime() + IST_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() };
}

/** Midnight IST on the first day of the month that `at` falls in (shifted by `monthOffset` months), as a UTC instant. */
export function istMonthStart(at: Date, monthOffset = 0): Date {
  const { year, month } = istParts(at);
  return new Date(Date.UTC(year, month + monthOffset, 1) - IST_OFFSET_MS);
}

export function monthKey(at: Date): string {
  const { year, month } = istParts(at);
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** The last `count` month keys ("2026-09"), oldest first, ending with the month of `now`. */
export function recentMonths(now: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(monthKey(new Date(istMonthStart(now, -i).getTime() + 60_000)));
  return out;
}

export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : key;
}

/** One point per requested month; a month with no revenue is zero, never missing. Amounts are exact decimal strings. */
export function fillMonths(months: string[], rows: { period: string; amount: string }[]): { period: string; earnings: number }[] {
  const byPeriod = new Map(rows.map((r) => [r.period, r.amount]));
  return months.map((period) => {
    const amount = byPeriod.get(period);
    return { period, earnings: amount === undefined ? 0 : paiseToNumber(roundToPaise(parseUnits(amount))) };
  });
}
