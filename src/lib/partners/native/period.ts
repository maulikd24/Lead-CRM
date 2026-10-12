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

/* ---------------------------------------------------------------- financial years and statement periods */

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const FY_KEY = /^(\d{4})-(\d{2})$/;

/** The financial year (April to March, IST) an instant falls in, as "2026-27". */
export function fyKeyOf(at: Date): string {
  const { year, month } = istParts(at);
  return fyKeyFromStartYear(month >= 3 ? year : year - 1);
}

function fyKeyFromStartYear(y: number): string {
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function fyKeyOfMonth(key: string): string {
  const m = MONTH_KEY.exec(key);
  if (!m) throw new Error("Not a month key");
  const y = Number(m[1]);
  return fyKeyFromStartYear(Number(m[2]) >= 4 ? y : y - 1);
}

/** The exact IST bounds of a financial year as UTC instants (end exclusive), or null when the key is not a year pair. */
export function fyRange(key: string): { start: Date; end: Date } | null {
  const m = FY_KEY.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  if (Number(m[2]) !== (y + 1) % 100) return null;
  return { start: new Date(Date.UTC(y, 3, 1) - IST_OFFSET_MS), end: new Date(Date.UTC(y + 1, 3, 1) - IST_OFFSET_MS) };
}

export function fyLabel(key: string): string {
  const y = Number(key.slice(0, 4));
  return `FY ${key} (Apr ${y} to Mar ${y + 1})`;
}

/** The twelve month keys of a financial year, in order. */
export function fyMonths(key: string): string[] {
  const y = Number(key.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const month = ((i + 3) % 12) + 1;
    const year = month >= 4 ? y : y + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  });
}

/** The exact IST bounds of a calendar month as UTC instants (end exclusive), or null when the key is not "yyyy-mm". */
export function monthRange(key: string): { start: Date; end: Date } | null {
  const m = MONTH_KEY.exec(key);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(y, mo, 1) - IST_OFFSET_MS), end: new Date(Date.UTC(y, mo + 1, 1) - IST_OFFSET_MS) };
}

export type StatementPeriod = { kind: "open" } | { kind: "run"; runId: string } | { kind: "month"; month: string } | { kind: "fy"; fy: string } | { kind: "fyc"; fy: string };

/**
 * What a statement's `run` URL value stands for: "open" (accruals not yet in a run), "m-2026-09" (a calendar month),
 * "fy-2026-27" (a financial year), "fyc-2026-27" (the financial year to date, month by month, for tax filing) or a payout run id.
 */
export function parseStatementPeriod(value: string): StatementPeriod | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) return null;
  if (value === "open") return { kind: "open" };
  const month = /^m-(\d{4}-\d{2})$/.exec(value);
  if (month) return monthRange(month[1]) ? { kind: "month", month: month[1] } : null;
  const fyc = /^fyc-(\d{4}-\d{2})$/.exec(value);
  if (fyc) return fyRange(fyc[1]) ? { kind: "fyc", fy: fyc[1] } : null;
  const fy = /^fy-(\d{4}-\d{2})$/.exec(value);
  if (fy) return fyRange(fy[1]) ? { kind: "fy", fy: fy[1] } : null;
  if (/^(m|fy|fyc)-/.test(value)) return null;
  return { kind: "run", runId: value };
}
