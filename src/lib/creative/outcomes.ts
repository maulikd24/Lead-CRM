import type { OutcomeReport } from "@/lib/attribution";
import type { AdChannel } from "@/lib/marketing/channels";
import type { CreativeReport } from "@/lib/marketing/creatives";

/**
 * Creative intelligence and the campaign outcomes. There is ONE source of outcomes: the CampaignOutcomeProvider in lib/attribution (spend,
 * leads, funded customers, revenue and cost per funded customer, by campaign and ad). This module has no provider of its own and does no
 * spend, funded or cost arithmetic: it joins the provider's ad rows to what the ad platforms delivered per ad (impressions and clicks, from
 * the marketing module), by channel, campaign and ad name. Pure.
 *
 * Honesty: a number the provider does not have is null, never zero. KYC is not computed per ad (the provider says so), so it is null here.
 * When no lead anywhere carries an ad marker, ads show the platform's own numbers only ("platform_only") and the note says why.
 */

export type AdOutcomeRow = {
  channel: AdChannel;
  campaignId: string;
  campaignName: string;
  adId: string;
  adName: string;
  format: string | null;
  /** The provider's spend for this ad, major units of `currency`. */
  spend: number | null;
  currency: string | null;
  impressions: number | null;
  clicks: number | null;
  /** The ad platform's own lead count. */
  platformLeads: number | null;
  /** Leads the CRM first-touch attributed to this ad. */
  leads: number | null;
  kyc: null;
  funded: number | null;
  /** Net revenue booked for those customers, in INR. */
  revenue: number | null;
  /** The provider's figure; null when there is no spend or nobody funded. */
  costPerFunded: number | null;
  /** "crm": leads and funded are the CRM's. "platform_only": no lead carries an ad marker, so only the platform's numbers exist. */
  outcomes: "crm" | "platform_only";
};

export type AdOutcomes = { rows: AdOutcomeRow[]; currency: string | null; /** When spend was last synced (ISO), the age of the data. */ asOf: string | null; notes: string[] };

const NO_AD_MARKER = "Ad-level funded counts need an ad id on each lead (the ad_id or utm_content field). None was found, so ads show the platform's own numbers only.";

export function joinAdOutcomes(report: OutcomeReport, delivery: CreativeReport): AdOutcomes {
  const adRows = report.rows.filter((r) => r.grain === "ad");
  const byKey = new Map(adRows.map((r) => [r.key, r]));
  const hasAdMarker = adRows.some((r) => r.leads > 0);
  const notes = [...report.notes];
  if (!hasAdMarker) notes.push(NO_AD_MARKER);
  if (delivery.otherCurrencyRows > 0) notes.push(`${delivery.otherCurrencyRows} ad rows in another currency were left out.`);

  const rows: AdOutcomeRow[] = delivery.ads.map((a) => {
    const canon = byKey.get(`${a.channel}:${a.campaignId}::${a.adName}`);
    return {
      channel: a.channel, campaignId: a.campaignId, campaignName: a.campaignName, adId: a.adId, adName: a.adName, format: a.format || null,
      spend: canon ? canon.spend : null, currency: canon ? canon.currency : delivery.currency,
      impressions: a.impressions, clicks: a.clicks, platformLeads: a.leads,
      leads: hasAdMarker ? (canon?.leads ?? 0) : null, kyc: null,
      funded: hasAdMarker ? (canon?.funded ?? 0) : null, revenue: hasAdMarker ? (canon?.revenue ?? 0) : null,
      costPerFunded: hasAdMarker ? (canon?.costPerFunded ?? null) : null,
      outcomes: hasAdMarker ? "crm" : "platform_only",
    };
  });
  const syncs = report.dataAge.spend.map((s) => s.lastSyncAt).filter((x): x is string => x !== null).sort();
  return { rows, currency: report.currency, asOf: syncs.length ? syncs[syncs.length - 1] : null, notes };
}
