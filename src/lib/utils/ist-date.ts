// India is a fixed UTC+5:30 offset with no DST — a manual shift is correct forever for this
// India-only app, regardless of the runtime's own system timezone (Vercel serverless functions
// run in UTC by default, unlike local dev machines, which may be in IST). Do not copy this
// pattern into a feature that needs real multi-timezone handling.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** A Date whose UTC-component getters (getUTCFullYear/getUTCMonth/getUTCDate/...) read out IST
 * wall-clock values — a numeric trick, not a real instant, so never use it for anything other
 * than extracting date/time parts. */
export function istShifted(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

/** The real UTC instants marking the start/end of the IST calendar day containing `date`, safe to
 * use directly in Prisma gte/lt comparisons regardless of the runtime's own timezone. */
export function istDayBoundaries(date: Date): { dayStart: Date; dayEnd: Date } {
  const ist = istShifted(date);
  const dayStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return { dayStart, dayEnd };
}

/** "YYYY-MM-DD" for the IST calendar day containing `date` — for date-input values, query
 * params, and filenames, where `.toISOString().slice(0, 10)` would cross the day boundary. */
export function istDateKey(date: Date): string {
  return istShifted(date).toISOString().slice(0, 10);
}

/** Human-readable IST calendar date (e.g. "20 Sept 2026"), correct regardless of runtime timezone. */
export function formatIstDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(date);
}
