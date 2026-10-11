/** Pure number crunching for the workspace. No invented figures: where the platform did not report something, the answer is null. */
export type StatusCount = { status: string; n: number };

export function summariseStatuses(rows: StatusCount[]) {
  const by = (...s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((t, r) => t + r.n, 0);
  return { sent: by("SENT"), failed: by("FAILED", "DEAD"), waiting: by("PENDING", "SENDING"), skipped: by("SKIPPED"), total: rows.reduce((t, r) => t + r.n, 0) };
}

/** Of the events where the platform said whether it matched. Null when it said nothing about any. */
export function matchRate(c: { matched: number; unmatched: number }): { rate: number; reported: number } | null {
  const reported = c.matched + c.unmatched;
  return reported === 0 ? null : { rate: c.matched / reported, reported };
}

export const SMALL_SAMPLE = 10;

/** `part` of `total`, never above 1; null when there is nothing to divide by. `small` says the base is too small for the share to mean much. */
export function shareOf(part: number, total: number): { share: number; small: boolean } | null {
  if (total <= 0) return null;
  return { share: Math.min(1, part / total), small: total < SMALL_SAMPLE };
}

export type ReasonCount = { status: string; reason: string | null; n: number };

/** Of the conversion events the closed loop detected: how many went, are waiting or failed for good, and why the rest were held back. Counts only. */
export function eventCoverage(rows: ReasonCount[]) {
  const sum = (f: (r: ReasonCount) => boolean) => rows.filter(f).reduce((t, r) => t + r.n, 0);
  const held = new Map<string, number>();
  for (const r of rows) if (r.status === "SKIPPED") held.set(r.reason ?? "UNKNOWN", (held.get(r.reason ?? "UNKNOWN") ?? 0) + r.n);
  return {
    detected: sum(() => true),
    sent: sum((r) => r.status === "SENT"),
    waiting: sum((r) => r.status === "PENDING" || r.status === "SENDING" || r.status === "FAILED"),
    failed: sum((r) => r.status === "DEAD"),
    held: [...held.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason)),
  };
}
