/**
 * The one "how old is this, and may I still lean on it" helper. Wave 2 convention: every intelligence object carries an as-of
 * date and a freshness policy, and nothing presents old data as current. Pure; other modules (decision engine, attention,
 * memory, household views) call it instead of writing their own age arithmetic.
 */

export type FreshnessStatus = "fresh" | "aging" | "stale" | "unknown";

export type FreshnessInput = {
  /** When the fact was observed (or the source was last true). Null = nobody recorded it. */
  asOf: Date | null | undefined;
  /** Explicit expiry. Beats maxAgeDays. */
  freshUntil?: Date | null;
  /** Policy: older than this is stale. Omit for "no age limit". */
  maxAgeDays?: number | null;
};

export type FreshnessResult = { status: FreshnessStatus; ageDays: number | null };

const DAY = 86_400_000;

export function ageDays(asOf: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - asOf.getTime()) / DAY));
}

/** A fact is "aging" in the last quarter of its allowed life, so the UI can warn before it expires. */
const AGING_FRACTION = 0.75;

export function assessFreshness(input: FreshnessInput, now: Date): FreshnessResult {
  const { asOf, freshUntil, maxAgeDays } = input;
  if (!asOf) return { status: "unknown", ageDays: null };
  // An as-of date in the future is bad data or clock skew: never call it fresh.
  if (asOf.getTime() - now.getTime() > DAY) return { status: "unknown", ageDays: null };
  const age = ageDays(asOf, now);
  if (freshUntil) {
    if (freshUntil.getTime() <= now.getTime()) return { status: "stale", ageDays: age };
    const life = freshUntil.getTime() - asOf.getTime();
    const used = now.getTime() - asOf.getTime();
    return { status: life > 0 && used / life >= AGING_FRACTION ? "aging" : "fresh", ageDays: age };
  }
  if (maxAgeDays != null) {
    if (age > maxAgeDays) return { status: "stale", ageDays: age };
    return { status: age >= maxAgeDays * AGING_FRACTION ? "aging" : "fresh", ageDays: age };
  }
  return { status: "fresh", ageDays: age };
}

/** True for stale AND unknown: a consumer that must not rely on the data treats both the same. */
export function isStale(input: FreshnessInput, now: Date): boolean {
  const { status } = assessFreshness(input, now);
  return status === "stale" || status === "unknown";
}

export function ageLabel(asOf: Date | null | undefined, now: Date): string {
  if (!asOf) return "no date";
  const d = ageDays(asOf, now);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} months ago`;
  const y = Math.floor(d / 365);
  return `${y} ${y === 1 ? "year" : "years"} ago`;
}
