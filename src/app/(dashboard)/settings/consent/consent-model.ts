import { DND_PURPOSE, type ConsentPolicy } from "@/lib/consent/policy";
import type { PurposeCounts } from "@/lib/consent/stats";

/** The sections of the consent admin workspace, in tab order. */
export const CONSENT_TABS = [
  { key: "overview", label: "Overview" },
  { key: "ledger", label: "Ledger" },
  { key: "withdrawals", label: "Withdrawals" },
  { key: "policy", label: "Policy and export" },
] as const;
export const CONSENT_TAB_KEYS = CONSENT_TABS.map((t) => t.key);

export type RecentWithdrawal = { id: string; purpose: string; channel: string | null; source: string; at: Date; clientId: string; clientCode: string };

const DAY = 24 * 60 * 60 * 1000;

/** Share of customers with a current grant (lead-form grants included), 0 to 100. */
export function grantedPct(c: PurposeCounts): number {
  const total = c.granted + c.legacyGranted + c.withdrawn + c.expired + c.notRecorded;
  return total === 0 ? 0 : Math.round(((c.granted + c.legacyGranted) / total) * 100);
}

/** Numbers for the rail. Everything is derived from what the page already loaded. */
export function summariseConsent({ policy, counts, recent, now }: { policy: ConsentPolicy; counts: PurposeCounts[]; recent: RecentWithdrawal[]; now: Date }) {
  return {
    dndInForce: counts.find((c) => c.purpose === DND_PURPOSE)?.granted ?? 0,
    withdrawnLast24h: recent.filter((r) => now.getTime() - r.at.getTime() < DAY).length,
    optInPurposes: Object.values(policy).filter((p) => p.mode === "required").length,
  };
}
