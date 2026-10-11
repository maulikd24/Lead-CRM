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

export function coverageShare(c: { funded: number; sendable: number }): { share: number; small: boolean } | null {
  if (c.funded <= 0) return null;
  return { share: Math.min(1, c.sendable / c.funded), small: c.funded < SMALL_SAMPLE };
}

export const campaignLabel = (v: string | null | undefined): string => (v?.trim() ? v.trim().slice(0, 60) : "No campaign recorded");
