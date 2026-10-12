export type PeriodDelta = { text: string; tone: "good" | "bad" | "flat" };

/**
 * How a figure moved against the previous period, as shown under a KPI ("▲ 12%"). Null when there's nothing to
 * compare (both zero). From zero to something has no meaningful percentage, so it reads "New". `lowerIsBetter`
 * flips the colour for figures like onboarding time, where a fall is good news.
 */
export function describePeriodDelta(current: number, previous: number, opts: { lowerIsBetter?: boolean } = {}): PeriodDelta | null {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) return { text: "New", tone: opts.lowerIsBetter ? "flat" : "good" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "No change", tone: "flat" };
  const up = pct > 0;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(pct)}%`, tone: up !== Boolean(opts.lowerIsBetter) ? "good" : "bad" };
}
