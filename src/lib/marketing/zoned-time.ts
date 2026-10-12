import { addDays, dateToYmd, ymdToDate } from "./dates";

/** Wall-clock times in a named timezone, and month grids for the content calendar. Pure. */

function parts(date: Date, timeZone: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** Offset of `timeZone` from UTC at an instant, in minutes. */
function offsetMinutes(at: Date, timeZone: string): number {
  const p = parts(at, timeZone);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at.getTime()) / 60_000;
}

/** "2026-10-20T09:30" read as a wall-clock time in `timeZone`; null for anything that is not a real time there. */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(asUtc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h || check.getUTCMinutes() !== mi) return null;
  try {
    // Two passes settle the offset across a daylight-saving change.
    let guess = new Date(asUtc - offsetMinutes(new Date(asUtc), timeZone) * 60_000);
    guess = new Date(asUtc - offsetMinutes(guess, timeZone) * 60_000);
    return guess;
  } catch {
    return null;
  }
}

export function formatInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** The value for an <input type="datetime-local"> showing `date` in `timeZone`. */
export function toLocalInputValue(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

export type GridDay = { date: string; inMonth: boolean };
export type MonthGrid = { month: string; label: string; prev: string; next: string; weeks: GridDay[][] };

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Whole Monday-first weeks covering `month` ("YYYY-MM"); a bad value falls back to the month of `todayYmd` (default: now, UTC). */
export function monthGrid(month: string, todayYmd: string = dateToYmd(new Date())): MonthGrid {
  const safe = MONTH.test(month) ? month : todayYmd.slice(0, 7);
  const first = `${safe}-01`;
  const lead = (ymdToDate(first).getUTCDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(Date.UTC(Number(safe.slice(0, 4)), Number(safe.slice(5)), 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const days: GridDay[] = Array.from({ length: total }, (_, i) => {
    const date = addDays(first, i - lead);
    return { date, inMonth: date.startsWith(safe) };
  });
  const weeks = Array.from({ length: total / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(ymdToDate(first));
  return { month: safe, label, prev: shiftMonth(safe, -1), next: shiftMonth(safe, 1), weeks };
}
