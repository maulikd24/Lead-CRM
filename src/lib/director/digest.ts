import { addDays, dateToYmd, todayInTimeZone, ymdToDate } from "@/lib/marketing/dates";
import { zonedLocalToUtc } from "@/lib/marketing/zoned-time";
import { formatCount, formatMoney } from "@/lib/marketing/view-model";

import type { DirectorReport } from "./report";

/** The weekly Monday digest: which week, when it is due, and the wording of the DRAFT email. Pure. Nothing here sends anything. */

export const DIGEST_TIMEZONE = "Asia/Kolkata";
export const DIGEST_HOUR_LOCAL = 7;

type Week = { from: string; to: string };

/** Monday to Sunday. The digest covers the last FULL week (India time) and compares it with the week before. */
export function previousWeeks(now: Date, timeZone: string = DIGEST_TIMEZONE): { current: Week; previous: Week; weekStart: string } {
  const today = todayInTimeZone(now, timeZone);
  const dow = ymdToDate(today).getUTCDay(); // 0 Sunday .. 6 Saturday
  const thisMonday = addDays(today, -((dow + 6) % 7));
  const from = addDays(thisMonday, -7);
  return { current: { from, to: addDays(thisMonday, -1) }, previous: { from: addDays(thisMonday, -14), to: addDays(thisMonday, -8) }, weekStart: from };
}

/** Due once the Monday after the week has reached 07:00 local, and until a digest exists for that week (so a missed Monday catches up). */
export function digestDue(now: Date, existingWeekStarts: ReadonlySet<string>, timeZone: string = DIGEST_TIMEZONE): { due: false } | { due: true; weekStart: string } {
  const { weekStart } = previousWeeks(now, timeZone);
  if (existingWeekStarts.has(weekStart)) return { due: false };
  const dueAt = zonedLocalToUtc(`${addDays(weekStart, 7)}T0${DIGEST_HOUR_LOCAL}:00`, timeZone);
  if (!dueAt || now.getTime() < dueAt.getTime()) return { due: false };
  return { due: true, weekStart };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;

export type DigestEmail = { subject: string; bodyText: string; recipients: string[] };

export function buildDigestEmail(report: DirectorReport, recipients: string[]): DigestEmail {
  const t = report.totals.current;
  const money = (n: number | null) => formatMoney(n, report.currency);
  const lines: string[] = [];
  lines.push("DRAFT FOR APPROVAL. Nothing has been sent. Read it, edit it if you wish, then send it yourself.");
  lines.push("");
  lines.push(`Marketing summary for ${short(report.period.from)} to ${short(report.period.to)}${report.comparePeriod ? ` (compared with ${short(report.comparePeriod.from)} to ${short(report.comparePeriod.to)})` : ""}`);
  lines.push("");
  if (!report.hasData) {
    lines.push("There was not enough connected data to report on this week.");
  } else {
    lines.push(`Funded customers: ${formatCount(t.funded)}`);
    lines.push(`Revenue booked: ${money(t.revenue)}`);
    lines.push(`Ad spend: ${money(t.spend)}`);
    lines.push(`Cost per funded customer: ${money(t.costPerFunded)}`);
    for (const [title, items] of [["What went well", report.wins], ["Watch", report.risks], ["Suggested next steps", report.nextActions]] as const) {
      if (items.length === 0) continue;
      lines.push("", `${title}:`);
      for (const i of items) lines.push(`- ${i}`);
    }
  }
  lines.push("");
  const stamp = report.freshness.map((f) => `${f.label}: ${f.asOf ? f.asOf.slice(0, 16).replace("T", " ") + " UTC" : "no sync time"}`).join("; ");
  lines.push(`Data as of: ${stamp || "not available"}. Report prepared ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC.`);
  lines.push("Numbers come from the CRM and the connected ad accounts. Customers who funded later are not in a week's count until they do.");
  return { subject: `Marketing summary: ${short(report.period.from)} to ${short(report.period.to)}`, bodyText: lines.join("\n"), recipients };
}

export { dateToYmd };
