import type { CampaignOutcomeProvider, OutcomePeriod } from "@/lib/attribution";

/**
 * How the closed loop reads marketing outcomes: ONLY through the CampaignOutcomeProvider, as the registered `closed-loop` consumer. It never counts funded customers
 * itself (a second definition of "funded" is a second source of truth), and it asks for nothing but leads, KYC and funded: no spend, cost or revenue reaches this
 * screen. Prisma-free; the provider is passed in so the same fixture gives the same numbers here as on Campaign impact.
 */
const IST_MS = 5.5 * 3_600_000;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The last `days` days ending today in the ad account's day (IST), inclusive, as YYYY-MM-DD. */
export function periodEndingOn(now: Date, days: number): OutcomePeriod {
  const end = now.getTime() + IST_MS;
  return { from: ymd(end - (days - 1) * 86_400_000), to: ymd(end) };
}

export type CampaignFunnelRow = { key: string; label: string; leads: number; kyc: number | null; funded: number; confidence: string };
export type CampaignFunnel = { supported: boolean; rows: CampaignFunnelRow[]; totals: { leads: number; funded: number } | null; dataNote: string | null };

export async function loadCampaignFunnel(provider: CampaignOutcomeProvider, now: Date = new Date(), days = 90): Promise<CampaignFunnel> {
  const report = await provider.outcomes({ grain: "campaign", period: periodEndingOn(now, days) }, { kind: "system", consumer: "closed-loop" });
  const rows = report.rows
    .filter((r) => r.rowKind === "campaign")
    .map((r): CampaignFunnelRow => ({ key: r.key, label: r.label, leads: r.leads, kyc: r.kyc, funded: r.funded, confidence: r.confidence.label }));
  return { supported: report.supported, rows, totals: report.totals ? { leads: report.totals.leads, funded: report.totals.funded } : null, dataNote: report.truncated ? "The lead window was cut at its limit: figures cover the most recent leads only." : null };
}
