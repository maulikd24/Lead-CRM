/** Flag and date-range helpers for the agent insights page. */

/** `NEXT_PUBLIC_INSIGHTS=1` turns the page and its Cmd+K entry on. Only the exact value 1 counts. */
export function insightsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_INSIGHTS === "1";
}

export const RANGE_OPTIONS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
] as const;

const DAY = 86_400_000;

export function resolveRange(param: string | string[] | undefined, now: Date) {
  const raw = Array.isArray(param) ? param[0] : param;
  const days = RANGE_OPTIONS.find((o) => String(o.days) === raw)?.days ?? 30;
  const from = new Date(now.getTime() - days * DAY);
  return { days, from, to: now, prevFrom: new Date(from.getTime() - days * DAY) };
}
