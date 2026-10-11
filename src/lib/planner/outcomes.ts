import type { CampaignOutcomeProvider, OutcomeCaller, OutcomeReport, OutcomeRow } from "@/lib/attribution";
import { addDays } from "@/lib/marketing/dates";

import type { ChannelKey } from "./channels";
import { estimateFunnel, type FunnelEstimate, type FunnelHistoryRow } from "./funnel";

/**
 * What our campaigns have brought in, as the planner sees it. EVERY number here comes from the canonical CampaignOutcomeProvider (spend, leads,
 * KYC, funded, confidence, data age); the planner counts nothing itself and reads no ad-spend or customer table (a boundary test pins that).
 *
 * The provider knows synced ad campaigns and source buckets (partner codes, referral codes, website forms, organic), not audiences, so history is
 * pooled by CHANNEL and says so. A channel with no matching bucket is "not measured", never a guess.
 */

export const PLANNER_CALLER: OutcomeCaller = { kind: "system", consumer: "planner" };
export const HISTORY_DAYS = 180;

export const historyPeriod = (today: string) => ({ from: addDays(today, -(HISTORY_DAYS - 1)), to: today });

type Selector = { kind: "campaign"; channel: "meta" | "google" } | { kind: "source"; keys: string[] } | null;
const SELECTORS: Record<ChannelKey, Selector> = {
  click_to_whatsapp: { kind: "campaign", channel: "meta" },
  search_ad: { kind: "campaign", channel: "google" },
  referral_community: { kind: "source", keys: ["referral_code"] },
  partner: { kind: "source", keys: ["partner_code"] },
  seo_content: { kind: "source", keys: ["organic", "form"] },
  email: null,
  short_video: null,
};

export type SourceInfo = {
  provider: string;
  period: { from: string; to: string };
  asOf: string;
  spend: { label: string; status: string; ageLabel: string | null }[];
  notes: string[];
  truncated: boolean;
  scope: string;
};

const sourceOf = (r: OutcomeReport, scope: string): SourceInfo => ({
  provider: r.provider, period: r.period, asOf: r.dataAge.asOf, spend: r.dataAge.spend.map((s) => ({ label: s.label, status: s.status, ageLabel: s.ageLabel })), notes: r.notes, truncated: r.truncated, scope,
});

const SCOPE_TEXT: Record<string, string> = {
  meta: "all synced Meta campaigns (audience is not recorded on a lead, so history is by channel)",
  google: "all synced Google campaigns (audience is not recorded on a lead, so history is by channel)",
  referral_code: "leads that arrived with a referral code",
  partner_code: "leads that arrived with a partner code",
  "organic+form": "organic sign-ups and website forms",
};

const NOT_MEASURED: Partial<Record<ChannelKey, string>> = {
  email: "Email is not tracked as its own source yet, so there is no history to estimate from.",
  short_video: "Short video is not tracked as its own source yet, so there is no history to estimate from.",
};

export type ChannelHistory =
  | { status: "ok"; rows: FunnelHistoryRow[]; source: SourceInfo }
  | { status: "not_measured"; reason: string }
  | { status: "unavailable"; reason: string };

const UNAVAILABLE = "The outcome numbers could not be read right now. Nothing is estimated without them.";

async function read(provider: CampaignOutcomeProvider, today: string): Promise<OutcomeReport | null> {
  try {
    const report = await provider.outcomes({ grain: "campaign", period: historyPeriod(today) }, PLANNER_CALLER);
    return report.supported ? report : null;
  } catch {
    return null;
  }
}

export async function loadChannelHistory(provider: CampaignOutcomeProvider, channel: ChannelKey, today: string): Promise<ChannelHistory> {
  const sel = SELECTORS[channel];
  if (!sel) return { status: "not_measured", reason: NOT_MEASURED[channel] ?? "This channel is not measured separately." };
  const report = await read(provider, today);
  if (!report) return { status: "unavailable", reason: UNAVAILABLE };
  const picked: OutcomeRow[] = report.rows.filter((r) => (sel.kind === "campaign" ? r.rowKind === "campaign" && r.channel === sel.channel : r.rowKind === "source" && sel.keys.includes(r.key)));
  const rows: FunnelHistoryRow[] = picked.map((r) => ({ leads: r.leads, kyc: r.kyc ?? 0, funded: r.funded, budgetInr: r.currency === "INR" && r.spend != null && r.spend > 0 ? r.spend : null }));
  const scopeKey = sel.kind === "campaign" ? sel.channel : sel.keys.join("+").replace("organic+form", "organic+form");
  return { status: "ok", rows, source: sourceOf(report, SCOPE_TEXT[scopeKey] ?? scopeKey) };
}

export type FunnelResult = {
  estimate: FunnelEstimate | { status: "not_measured"; reason: string } | { status: "unavailable"; reason: string };
  source: SourceInfo | null;
};

export async function funnelEstimateFor(provider: CampaignOutcomeProvider, plan: { channel: ChannelKey; budgetInr: number | null; expectedLeads?: number | null }, today: string): Promise<FunnelResult> {
  const h = await loadChannelHistory(provider, plan.channel, today);
  if (h.status !== "ok") return { estimate: h, source: null };
  return { estimate: estimateFunnel({ history: h.rows, plannedBudgetInr: plan.budgetInr, expectedLeads: plan.expectedLeads }), source: h.source };
}

export type PlanOutcome =
  | { status: "ok"; row: OutcomeRow; source: SourceInfo }
  | { status: "not_linked" }
  | { status: "not_found"; reason: string }
  | { status: "unavailable"; reason: string };

/** The outcomes of the ONE synced campaign a plan is linked to (`outcomeKey`). Unlinked plans are honestly "not measured". */
export async function planOutcomeFor(provider: CampaignOutcomeProvider, outcomeKey: string | null, today: string): Promise<PlanOutcome> {
  if (!outcomeKey) return { status: "not_linked" };
  const report = await read(provider, today);
  if (!report) return { status: "unavailable", reason: UNAVAILABLE };
  const row = report.rows.find((r) => r.key === outcomeKey && r.rowKind === "campaign");
  return row ? { status: "ok", row, source: sourceOf(report, "the linked ad campaign") } : { status: "not_found", reason: "The linked campaign has no leads or spend in the last 180 days." };
}

export type CampaignOption = { key: string; label: string; channel: "meta" | "google" | null };

export async function campaignOptions(provider: CampaignOutcomeProvider, today: string): Promise<CampaignOption[]> {
  const report = await read(provider, today);
  return (report?.rows ?? []).filter((r) => r.rowKind === "campaign").map((r) => ({ key: r.key, label: r.label, channel: r.channel }));
}
