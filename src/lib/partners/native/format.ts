const IST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-09-05" for an instant, as the calendar date in India (the firm's day). Empty for something that is not a date. */
export function istDay(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "" : IST_DAY.format(d);
}

/** "Brokerage", "Trail commission": an enum value for people. */
export function words(raw: string): string {
  const t = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}
