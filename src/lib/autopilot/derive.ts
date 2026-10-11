import { ratio, sum } from "./stats";
import type { AutopilotSnapshot, CampaignInfo, LeadRecord } from "./types";

/** Aggregates every module needs. Pure. */

export type CampaignTotals = {
  campaign: CampaignInfo;
  spend: number;
  impressions: number;
  clicks: number;
  platformLeads: number;
  crmLeads: number;
  contactedInSla: number;
  contacted: number;
  kyc: number;
  funded: number;
  revenue: number;
  roas: number | null;
  aum: number;
  ctr: number | null;
  cpl: number | null;
  clickToLead: number | null;
  costPerFunded: number | null;
};

export function totalsByCampaign(s: AutopilotSnapshot): CampaignTotals[] {
  return s.campaigns.map((campaign) => {
    const rows = s.days.filter((d) => d.campaignId === campaign.id);
    const leads = s.leads.filter((l) => l.campaignId === campaign.id);
    const spend = sum(rows.map((r) => r.spend));
    const impressions = sum(rows.map((r) => r.impressions));
    const clicks = sum(rows.map((r) => r.clicks));
    const platformLeads = sum(rows.map((r) => r.leads));
    const out = s.outcomes[campaign.id];
    return {
      campaign, spend, impressions, clicks, platformLeads,
      // After the click: the provider's numbers, never recomputed here.
      crmLeads: out?.leads ?? 0,
      contacted: leads.filter((l) => l.contactMinutes !== null).length,
      contactedInSla: out?.contactedInSla ?? 0,
      kyc: out?.kyc ?? 0,
      funded: out?.funded ?? 0,
      revenue: out?.revenue ?? 0,
      roas: out?.roas ?? null,
      aum: sum(leads.map((l) => l.aum)),
      ctr: ratio(clicks, impressions),
      cpl: ratio(spend, platformLeads),
      clickToLead: ratio(platformLeads, clicks),
      costPerFunded: out?.costPerFunded ?? null,
    };
  });
}

export const totalSpend = (s: AutopilotSnapshot) => sum(s.days.map((d) => d.spend));

/** Leads that carry no campaign, for the attribution control. */
export const unattributed = (leads: LeadRecord[]) => leads.filter((l) => !l.campaignId);

export const nameOf = (s: AutopilotSnapshot, id: string) => s.campaigns.find((c) => c.id === id)?.name ?? id;

/** Hours between the snapshot and its newest data; null when there is no data. */
export function dataAgeHours(s: AutopilotSnapshot): number | null {
  if (!s.dataThrough) return null;
  return Math.max(0, (Date.parse(s.asOf) - Date.parse(s.dataThrough)) / 3_600_000);
}

/** Short, honest phrase for how old the data is. */
export function dataAgeText(s: AutopilotSnapshot): string {
  const h = dataAgeHours(s);
  if (h === null) return "no platform data yet";
  if (h < 1) return "under an hour old";
  if (h < 48) return `${Math.round(h)} hours old`;
  return `${Math.round(h / 24)} days old`;
}

/** Wall-clock parts of an instant in the firm's timezone (a fixed offset: IST has no daylight saving). */
export function localParts(iso: string, offsetMinutes: number): { dow: number; hour: number; ymd: string } {
  const d = new Date(Date.parse(iso) + offsetMinutes * 60_000);
  return { dow: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours(), ymd: d.toISOString().slice(0, 10) };
}
