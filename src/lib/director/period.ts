import type { OutcomeReport } from "@/lib/attribution";

import type { CampaignPeriod, ChannelKey, ChannelPeriod, PeriodData } from "./report";

/**
 * Maps the CampaignOutcomeProvider's report for one period into the director report's period shape. Pure, and it adds nothing: no customer
 * query, no attribution rule of its own, no cost or return arithmetic. A channel whose programme is switched off (referral, partner) is
 * "not available" even if the provider has a row for it, so the report never shows a figure for something the firm is not running.
 */
export type Programmes = { referral: boolean; partner: boolean };

const COUNTED_ONCE = "A customer is counted once, under the first campaign, partner code or referral that reached them: the same rule as Campaign impact.";

export function periodFromOutcomes(input: { from: string; to: string; report: OutcomeReport; programmes: Programmes }): PeriodData {
  const { report, programmes } = input;
  const channels: ChannelPeriod[] = report.byChannel.map((c) => {
    const off = (c.channel === "referral" && !programmes.referral) || (c.channel === "partner" && !programmes.partner);
    if (off || !c.available) return { channel: c.channel, available: false, spend: null, leads: null, kyc: null, funded: null, revenue: null, costPerFunded: null, roas: null };
    return { channel: c.channel, available: true, spend: c.spend, leads: c.leads, kyc: c.kyc, funded: c.funded, revenue: c.revenue, costPerFunded: c.costPerFunded, roas: c.roas };
  });
  const campaigns: CampaignPeriod[] = report.rows
    .filter((r) => r.rowKind === "campaign" && r.channel !== null)
    .map((r) => ({ channel: r.channel as ChannelKey, campaignId: r.key.slice(r.key.indexOf(":") + 1), name: r.label, spend: r.spend, leads: r.leads, funded: r.funded, revenue: r.revenue }));
  const syncOf = (ch: "meta" | "google") => report.dataAge.spend.find((a) => a.channel === ch)?.lastSyncAt ?? null;
  return {
    from: input.from, to: input.to, currency: report.currency, channels, campaigns,
    asOf: { meta: syncOf("meta"), google: syncOf("google"), referral: null, partner: null },
    notes: [COUNTED_ONCE, ...report.notes],
    paid: { costPerFunded: report.paid.costPerFunded, roas: report.paid.roas },
  };
}
