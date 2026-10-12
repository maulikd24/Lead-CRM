const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MIN_DATE_MS = Date.UTC(2000, 0, 1);
/** Sender clocks may run this far ahead. */
export const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/** Strict ISO 8601: a calendar date, or a timestamp WITH Z/offset. Returns null for anything else (including 31 Feb). */
export function parseIso(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m = ISO_DATE.exec(s) ?? ISO.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59))) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

export function withinBounds(d: Date, now: number): boolean {
  return d.getTime() >= MIN_DATE_MS && d.getTime() <= now + FUTURE_SKEW_MS;
}
