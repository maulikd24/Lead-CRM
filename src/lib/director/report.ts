import { formatCount, formatMoney } from "@/lib/marketing/view-model";
import { isGoogleLead, isMetaLead } from "@/lib/marketing/attribution";

/**
 * The director report model. Pure: no database, no clock (the caller passes `generatedAt`).
 *
 * It blends four channels (Meta, Google, referral and partner) into funded customers and revenue per channel and per
 * campaign, with a comparison against the previous period, and writes wins, risks and next actions in plain English FROM
 * THE NUMBERS. Rules it keeps:
 *   - A number it does not have is null and shows as "not available", never zero and never estimated.
 *   - A trend is only claimed when the earlier period had enough funded customers to mean something.
 *   - Every sentence is built from a figure in the data; there is no free-text generation here.
 *   - It carries aggregates only: channel, campaign name and counts. No customer data of any kind.
 *   - Each customer is counted once: a customer who came through an ad stays with that ad channel even if a referral
 *     or partner code was also used (assignOtherChannel).
 * Thresholds are defaults, listed in THRESHOLDS, and shown on the report.
 */

export type ChannelKey = "meta" | "google" | "referral" | "partner";
export const CHANNEL_KEYS: readonly ChannelKey[] = ["meta", "google", "referral", "partner"];
export const CHANNEL_NAME: Record<ChannelKey, string> = { meta: "Meta", google: "Google", referral: "Referrals", partner: "Partners" };
const IS_AD: Record<ChannelKey, boolean> = { meta: true, google: true, referral: false, partner: false };

export const THRESHOLDS = {
  /** The earlier period needs at least this many funded customers before a rise or fall is called a trend. */
  minFundedForTrend: 5,
  risePct: 10,
  costRisePct: 20,
  costFallPct: 15,
  spendRisePct: 20,
  staleHours: 48,
  /** Fewer funded customers than this and channels cannot be compared with confidence. */
  fewFunded: 5,
} as const;

export type ChannelPeriod = { channel: ChannelKey; available: boolean; spend: number | null; leads: number | null; kyc: number | null; funded: number | null; revenue: number | null };
export type CampaignPeriod = { channel: ChannelKey; campaignId: string; name: string; spend: number | null; leads: number | null; funded: number | null; revenue: number | null };
export type PeriodData = { from: string; to: string; currency: string | null; channels: ChannelPeriod[]; campaigns: CampaignPeriod[]; asOf: Record<ChannelKey, string | null>; notes: string[] };

export type Metrics = { spend: number | null; leads: number | null; kyc: number | null; funded: number | null; revenue: number | null; costPerFunded: number | null; roas: number | null };
export type Delta = { abs: number; pct: number | null };
export type MetricDeltas = Partial<Record<"spend" | "leads" | "funded" | "revenue" | "costPerFunded", Delta>>;

export type ReportChannel = { channel: ChannelKey; label: string; available: boolean; current: Metrics; previous: Metrics | null; delta: MetricDeltas | null };
export type Freshness = { channel: ChannelKey; label: string; asOf: string | null; ageHours: number | null; stale: boolean };

export type DirectorReport = {
  generatedAt: string;
  period: { from: string; to: string };
  comparePeriod: { from: string; to: string } | null;
  currency: string | null;
  hasData: boolean;
  totals: { current: Metrics; previous: Metrics | null; delta: MetricDeltas | null };
  channels: ReportChannel[];
  campaigns: CampaignPeriod[];
  wins: string[];
  risks: string[];
  nextActions: string[];
  freshness: Freshness[];
  notes: string[];
  thresholds: typeof THRESHOLDS;
};

const sumOf = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};
const div = (a: number | null, b: number | null): number | null => (a !== null && b !== null && b > 0 && Number.isFinite(a / b) ? a / b : null);

function metricsOf(rows: ChannelPeriod[], currency: string | null): Metrics {
  const used = rows.filter((r) => r.available);
  const ads = used.filter((r) => IS_AD[r.channel]);
  const adSpend = sumOf(ads.map((r) => r.spend));
  const adFunded = sumOf(ads.map((r) => r.funded));
  const adRevenue = sumOf(ads.map((r) => r.revenue));
  return {
    spend: sumOf(used.map((r) => r.spend)),
    leads: sumOf(used.map((r) => r.leads)),
    kyc: sumOf(used.map((r) => r.kyc)),
    funded: sumOf(used.map((r) => r.funded)),
    revenue: sumOf(used.map((r) => r.revenue)),
    costPerFunded: div(adSpend, adFunded),
    roas: currency === "INR" && adRevenue !== null && adRevenue > 0 ? div(adRevenue, adSpend) : null,
  };
}

function oneChannel(r: ChannelPeriod | undefined, currency: string | null): Metrics {
  if (!r || !r.available) return { spend: null, leads: null, kyc: null, funded: null, revenue: null, costPerFunded: null, roas: null };
  return { spend: r.spend, leads: r.leads, kyc: r.kyc, funded: r.funded, revenue: r.revenue, costPerFunded: div(r.spend, r.funded), roas: currency === "INR" && r.revenue !== null && r.revenue > 0 ? div(r.revenue, r.spend) : null };
}

function deltas(cur: Metrics, prev: Metrics): MetricDeltas {
  const out: MetricDeltas = {};
  for (const k of ["spend", "leads", "funded", "revenue", "costPerFunded"] as const) {
    const a = cur[k];
    const b = prev[k];
    if (a === null || b === null) continue;
    out[k] = { abs: a - b, pct: b > 0 ? ((a - b) / b) * 100 : null };
  }
  return out;
}

const pctText = (n: number) => `${Math.round(Math.abs(n))}%`;
const ageText = (hours: number) => (hours >= 48 ? `${Math.round(hours / 24)} days old` : `${hours} hours old`);

export function buildDirectorReport(input: { current: PeriodData; previous: PeriodData | null; generatedAt: string }): DirectorReport {
  const { current, previous, generatedAt } = input;
  const currency = current.currency;
  const money = (n: number | null) => formatMoney(n, currency);
  const curTotals = metricsOf(current.channels, currency);
  const prevTotals = previous ? metricsOf(previous.channels, previous.currency) : null;
  const delta = prevTotals ? deltas(curTotals, prevTotals) : null;

  const channels: ReportChannel[] = CHANNEL_KEYS.map((channel) => {
    const c = current.channels.find((x) => x.channel === channel);
    const p = previous?.channels.find((x) => x.channel === channel);
    const cm = oneChannel(c, currency);
    const pm = previous ? oneChannel(p, previous.currency) : null;
    return { channel, label: CHANNEL_NAME[channel], available: Boolean(c?.available), current: cm, previous: pm, delta: pm ? deltas(cm, pm) : null };
  }).filter((c) => c.available || current.channels.some((x) => x.channel === c.channel));

  const freshness: Freshness[] = channels
    .filter((c) => c.available)
    .map((c) => {
      const asOf = IS_AD[c.channel] ? current.asOf[c.channel] : generatedAt;
      const ageHours = asOf ? Math.max(0, Math.round((Date.parse(generatedAt) - Date.parse(asOf)) / 3_600_000)) : null;
      return { channel: c.channel, label: c.label, asOf, ageHours, stale: IS_AD[c.channel] && ageHours !== null && ageHours > THRESHOLDS.staleHours };
    });

  const hasData = current.channels.some((c) => c.available && (c.funded !== null || c.spend !== null || c.leads !== null));

  const wins: string[] = [];
  const risks: string[] = [];
  const next: string[] = [];
  if (hasData) {
    const t = THRESHOLDS;
    const trendOk = prevTotals !== null && (prevTotals.funded ?? 0) >= t.minFundedForTrend;
    if (trendOk && delta) {
      const f = delta.funded;
      if (f && f.pct !== null && f.pct >= t.risePct) wins.push(`Funded customers rose from ${formatCount(prevTotals!.funded)} to ${formatCount(curTotals.funded)} (up ${pctText(f.pct)}).`);
      const r = delta.revenue;
      if (r && r.pct !== null && r.pct >= t.risePct && prevTotals!.revenue !== null) wins.push(`Revenue booked from these customers rose from ${money(prevTotals!.revenue)} to ${money(curTotals.revenue)}.`);
      const c = delta.costPerFunded;
      if (c && c.pct !== null && c.pct <= -t.costFallPct) wins.push(`Cost per funded customer fell from ${money(prevTotals!.costPerFunded)} to ${money(curTotals.costPerFunded)}.`);
      if (c && c.pct !== null && c.pct >= t.costRisePct) risks.push(`Cost per funded customer rose from ${money(prevTotals!.costPerFunded)} to ${money(curTotals.costPerFunded)}.`);
      if (r && r.pct !== null && r.pct <= -t.risePct * 2 && (prevTotals!.revenue ?? 0) > 0) risks.push(`Revenue booked fell from ${money(prevTotals!.revenue)} to ${money(curTotals.revenue)}.`);
      const s = delta.spend;
      if (s && s.pct !== null && s.pct >= t.spendRisePct && f && f.abs <= 0) risks.push(`Ad spend rose from ${money(prevTotals!.spend)} to ${money(curTotals.spend)} while funded customers did not rise.`);
    }
    const totalFunded = curTotals.funded ?? 0;
    if (totalFunded >= t.fewFunded) {
      const best = [...channels].filter((c) => c.available && (c.current.funded ?? 0) > 0).sort((a, b) => (b.current.funded ?? 0) - (a.current.funded ?? 0))[0];
      if (best) wins.push(`${best.label} brought the most funded customers: ${formatCount(best.current.funded)} of ${formatCount(totalFunded)}.`);
    } else {
      next.push("Too few funded customers to compare channels with confidence. Treat differences as directional and wait for more data before moving budget.");
    }
    for (const c of channels) {
      if (!IS_AD[c.channel] || !c.available) continue;
      if ((c.current.spend ?? 0) > 0 && c.current.funded === 0) {
        risks.push(`${c.label} spent ${money(c.current.spend)} and no customer has funded yet. Customers from this period may still fund later.`);
        next.push(`Review the ${c.label} campaigns that spent without a funded customer before adding budget.`);
      }
    }
    for (const f of freshness) {
      if (f.stale && f.ageHours !== null) {
        risks.push(`${f.label} data is ${ageText(f.ageHours)}, so this report may be behind.`);
        next.push(`Check the ${f.label} ad sync in Apps and Integrations before relying on these numbers.`);
      }
    }
    if (delta?.costPerFunded && delta.costPerFunded.pct !== null && delta.costPerFunded.pct >= t.costRisePct) next.push("Compare this period's campaigns with last period's to find which one became more expensive per funded customer.");
    if (wins.length > 0 && totalFunded >= t.fewFunded) next.push("Open the Creative tab and look at what the best campaigns have in common before shifting budget.");
  }

  const campaigns = [...current.campaigns].sort((a, b) => (b.revenue ?? -1) - (a.revenue ?? -1) || (b.funded ?? -1) - (a.funded ?? -1)).slice(0, 10);
  return {
    generatedAt,
    period: { from: current.from, to: current.to },
    comparePeriod: previous ? { from: previous.from, to: previous.to } : null,
    currency,
    hasData,
    totals: { current: curTotals, previous: prevTotals, delta },
    channels,
    campaigns,
    wins: wins.slice(0, 4),
    risks: risks.slice(0, 4),
    nextActions: [...new Set(next)].slice(0, 4),
    freshness,
    notes: current.notes,
    thresholds: THRESHOLDS,
  };
}

export type OtherChannelInput = { hasPartnerTouch: boolean; hasReferral: boolean; attribution: Record<string, unknown> | null; leadSource: string | null };

/**
 * Which non-ad channel a customer belongs to, or null. A customer who came through a Meta or Google ad stays with that ad
 * channel (the Marketing numbers already count them there), so the report never counts one person twice. Partner comes
 * before referral, the same precedence the sign-up webhook uses.
 */
export function assignOtherChannel(c: OtherChannelInput): "partner" | "referral" | null {
  const lead = { clientId: "", day: "", leadSource: c.leadSource, attribution: c.attribution };
  if (isMetaLead(lead) || isGoogleLead(lead)) return null;
  if (c.hasPartnerTouch) return "partner";
  if (c.hasReferral) return "referral";
  return null;
}
