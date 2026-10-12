import { LIVE } from "@/components/motion/tokens";

export type FunnelTotals = { leads: number; kyc: number; funded: number; activated: number };
export type StageKey = "leads" | "contacted" | "kyc" | "funded" | "activated";
export type FunnelStage = { key: StageKey; label: string; count: number; /** share of all leads, 0-100 */ share: number; /** % of the previous stage that reached this one; null for the first */ conversion: number | null };

const LABELS: Record<StageKey, string> = { leads: "Leads", contacted: "Contacted", kyc: "KYC approved", funded: "Funded", activated: "Activated" };
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

/**
 * Funnel rows from the existing management totals. "Contacted" comes from lifecycle counts
 * (everyone no longer at "Lead" or "Lost"); it is left out when no lifecycle data exists.
 */
export function buildFunnelStages(totals: FunnelTotals, lifecycle: Record<string, number>): FunnelStage[] {
  const hasLifecycle = Object.values(lifecycle).some((n) => n > 0);
  const counts: { key: StageKey; count: number }[] = [{ key: "leads", count: totals.leads }];
  if (hasLifecycle) {
    const contacted = totals.leads - (lifecycle.Lead ?? 0) - (lifecycle.Lost ?? 0);
    counts.push({ key: "contacted", count: Math.min(totals.leads, Math.max(totals.kyc, contacted)) });
  }
  counts.push({ key: "kyc", count: totals.kyc }, { key: "funded", count: totals.funded }, { key: "activated", count: totals.activated });
  return counts.map((c, i) => ({
    key: c.key,
    label: LABELS[c.key],
    count: c.count,
    share: pct(c.count, totals.leads),
    conversion: i === 0 ? null : pct(c.count, counts[i - 1].count),
  }));
}

/** Which stage counts went up between two polls. */
export function risenStages(prev: FunnelTotals, next: FunnelTotals): (keyof FunnelTotals)[] {
  return (Object.keys(next) as (keyof FunnelTotals)[]).filter((k) => next[k] > prev[k]);
}

/** Poll interval: the base when healthy, doubling per consecutive failure up to a ceiling. */
export function nextPollDelay(failures: number): number {
  return Math.min(LIVE.pollMs * 2 ** Math.max(0, failures), LIVE.maxBackoffMs);
}

export const CELEBRATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SEEN_LIMIT = 50;

export type FundedLatest = { id: string; firstName: string; atIso: string };

/**
 * Celebrate a funded customer once. `seen` is a bounded list of ids already handled, so A, B, A never
 * celebrates A twice. Stale fundings (older than 7 days) are recorded but not celebrated.
 */
export function decideCelebration(latest: FundedLatest | null, seen: string[], now: Date): { celebrate: boolean; seen: string[] } {
  if (!latest || seen.includes(latest.id)) return { celebrate: false, seen };
  const recent = now.getTime() - new Date(latest.atIso).getTime() <= CELEBRATION_WINDOW_MS;
  return { celebrate: recent, seen: [...seen, latest.id].slice(-SEEN_LIMIT) };
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? "";
}
