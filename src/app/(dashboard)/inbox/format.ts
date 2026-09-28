import { formatIstDate, istDateKey } from "@/lib/utils/ist-date";

// Everything is pinned to IST so the server render and the browser hydrate to identical text
// regardless of either side's own timezone.
const timeFormatter = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function formatChatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** Compact label for the conversation list: time today, "Yesterday", otherwise the date. */
export function formatListTimestamp(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const today = istDateKey(now);
  const day = istDateKey(date);
  if (day === today) return formatChatTime(iso);
  if (day === istDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return "Yesterday";
  return formatIstDate(date);
}

/** Day-separator label inside a thread. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const day = istDateKey(date);
  if (day === istDateKey(now)) return "Today";
  if (day === istDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return "Yesterday";
  return formatIstDate(date);
}
