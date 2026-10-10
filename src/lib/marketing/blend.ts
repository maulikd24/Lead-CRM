import { AD_CHANNELS, CHANNEL_LABEL, type AdChannel } from "./channels";
import type { CampaignRow, MarketingReport, ReportNote } from "./metrics";

/** Combines the per-channel reports into the blended Overview numbers. Pure: no database, no clock. */

const div = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);

export type BlendedTotals = {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  crmLeads: number;
  kyc: number;
  funded: number;
  aum: number;
  revenue: number;
  cpl: number | null;
  costPerFunded: number | null;
  /** Revenue / spend; INR only, and blank until there is revenue (same rule as the per-channel report). */
  roas: number | null;
};

export type ChannelSummary = {
  channel: AdChannel;
  label: string;
  spend: number;
  spendShare: number;
  crmLeads: number;
  funded: number;
  revenue: number;
  cpl: number | null;
  costPerFunded: number | null;
  roas: number | null;
  campaigns: number;
};

export type BlendedDay = { date: string; spend: number; byChannel: Record<AdChannel, number>; crmLeads: number; funded: number };
export type BlendedCampaign = CampaignRow & { channel: AdChannel };

export type BlendedReport = {
  range: { from: string; to: string };
  currency: string | null;
  totals: BlendedTotals;
  channels: ChannelSummary[];
  daily: BlendedDay[];
  campaigns: BlendedCampaign[];
  notes: ReportNote[];
};

export function blendReports(reports: Partial<Record<AdChannel, MarketingReport>>): BlendedReport {
  const present = AD_CHANNELS.flatMap((channel) => (reports[channel] ? [{ channel, report: reports[channel] as MarketingReport }] : []));
  const notes: ReportNote[] = [];

  // Amounts in different currencies cannot be added: the channel with the most spend sets the currency, the rest are left out.
  const ranked = [...present].sort((a, b) => b.report.totals.spend - a.report.totals.spend);
  const currency = ranked.find((p) => p.report.currency)?.report.currency ?? null;
  const used = present.filter((p) => p.report.currency === currency || p.report.currency === null);
  for (const p of present) {
    if (!used.includes(p)) notes.push({ tone: "warning", text: `${CHANNEL_LABEL[p.channel]} is billed in ${p.report.currency}, not ${currency}, so it is left out of the blended numbers.` });
  }

  const sum = (pick: (r: MarketingReport) => number) => used.reduce((acc, p) => acc + pick(p.report), 0);
  const spend = sum((r) => r.totals.spend);
  const crmLeads = sum((r) => r.totals.crmLeads);
  const funded = sum((r) => r.totals.funded);
  const revenue = sum((r) => r.totals.revenue);
  const impressions = sum((r) => r.totals.impressions);
  const clicks = sum((r) => r.totals.clicks);
  const inr = currency === "INR";

  const channels: ChannelSummary[] = used.map(({ channel, report }) => ({
    channel,
    label: CHANNEL_LABEL[channel],
    spend: report.totals.spend,
    spendShare: spend > 0 ? report.totals.spend / spend : 0,
    crmLeads: report.totals.crmLeads,
    funded: report.totals.funded,
    revenue: report.totals.revenue,
    cpl: report.totals.cpl,
    costPerFunded: report.totals.costPerFunded,
    roas: report.totals.roas,
    campaigns: report.campaigns.length,
  }));

  const days = new Map<string, BlendedDay>();
  for (const { channel, report } of used) {
    for (const d of report.daily) {
      const day = days.get(d.date) ?? { date: d.date, spend: 0, byChannel: { meta: 0, google: 0 }, crmLeads: 0, funded: 0 };
      day.spend += d.spend;
      day.byChannel[channel] += d.spend;
      day.crmLeads += d.crmLeads;
      day.funded += d.funded;
      days.set(d.date, day);
    }
  }

  const from = used.map((p) => p.report.range.from).sort()[0] ?? "";
  const to = used.map((p) => p.report.range.to).sort().reverse()[0] ?? "";
  for (const p of used) for (const n of p.report.notes) notes.push({ tone: n.tone, text: `${CHANNEL_LABEL[p.channel]}: ${n.text}` });

  return {
    range: { from, to },
    currency,
    totals: {
      spend,
      impressions,
      clicks,
      ctr: div(clicks, impressions),
      crmLeads,
      kyc: sum((r) => r.totals.kyc),
      funded,
      aum: sum((r) => r.totals.aum),
      revenue,
      cpl: div(spend, crmLeads),
      costPerFunded: div(spend, funded),
      roas: inr && revenue > 0 ? div(revenue, spend) : null,
    },
    channels,
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    campaigns: used.flatMap(({ channel, report }) => report.campaigns.map((c) => ({ ...c, channel }))).sort((a, b) => b.spend - a.spend || b.crmLeads - a.crmLeads),
    notes,
  };
}
