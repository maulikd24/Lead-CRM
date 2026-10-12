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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Sep 2026" for an instant (the date in India). A dash for something that is not a date. */
export function longDay(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const day = istDay(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—";
}

/** "1 Sep 2026 to 30 Sep 2026" for a payout period whose end is exclusive (the end instant is the start of the next day). */
export function periodLabel(start: string, end: string): string {
  const endInclusive = new Date(new Date(end).getTime() - 1);
  return `${longDay(start)} to ${longDay(endInclusive)}`;
}

/** A shorter period for a table: "1 to 30 Sep 2026" inside one month, the single day when it is one, otherwise both ends in full. */
export function periodShort(start: string, end: string): string {
  const a = longDay(start);
  const b = longDay(new Date(new Date(end).getTime() - 1));
  if (a === b) return a;
  const [da, ma, ya] = a.split(" ");
  const [db, mb, yb] = b.split(" ");
  return ma === mb && ya === yb ? `${da} to ${db} ${mb} ${yb}` : `${a} to ${b}`;
}
