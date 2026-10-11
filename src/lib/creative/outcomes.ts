import type { AdChannel } from "@/lib/marketing/channels";
import { buildCreativeReport, type CreativeDayRow } from "@/lib/marketing/creatives";
import type { MarketingReport } from "@/lib/marketing/metrics";
import { normalizeCampaignName } from "@/lib/marketing/attribution";
import { currencyExponent } from "@/lib/marketing/money";

import type { DailyPoint } from "./fatigue";

/**
 * The seam to the attribution module. The creative and report modules never read tables for campaign outcomes: they ask a
 * CampaignOutcomeProvider. This file defines the interface, a FAKE for tests and the demo, and a SIMPLE implementation
 * over data that already exists (the Marketing reports and per-ad rows). When the attribution module lands, it provides
 * its own implementation of the same interface and the factory in outcomes-db.ts returns that instead.
 *
 * Honesty rules: a number we do not have is null, never zero. Contacted-in-SLA is null until the attribution module
 * supplies it. Ad-level outcomes exist only when leads carry an ad id; otherwise an ad row holds the platform's own
 * numbers and says "platform only".
 */

export type OutcomeLevel = "campaign" | "ad";

export type OutcomeQuery = { from: string; to: string; level: OutcomeLevel; channel?: AdChannel };

export type OutcomeRow = {
  level: OutcomeLevel;
  channel: AdChannel;
  campaignId: string;
  campaignName: string;
  adId: string | null;
  adName: string | null;
  format: string | null;
  /** Major units of `currency`. */
  spend: number | null;
  currency: string | null;
  impressions: number | null;
  clicks: number | null;
  /** The ad platform's own lead count. */
  platformLeads: number | null;
  /** Leads the CRM received and matched. Null when the CRM cannot say. */
  leads: number | null;
  contactedInSla: number | null;
  kyc: number | null;
  funded: number | null;
  /** Net revenue booked for those customers, in INR. */
  revenue: number | null;
  /** "crm": leads, KYC and funded are the CRM's own numbers. "platform_only": only the platform's numbers exist at this level. */
  outcomes: "crm" | "platform_only";
};

export type OutcomeResult = { rows: OutcomeRow[]; currency: string | null; /** When the freshest data was synced (ISO). */ asOf: string | null; notes: string[] };
export type DailySeries = { channel: AdChannel; level: OutcomeLevel; campaignId: string; adId: string | null; name: string; points: DailyPoint[] };

export interface CampaignOutcomeProvider {
  readonly name: string;
  getOutcomes(query: OutcomeQuery): Promise<OutcomeResult>;
  /** Day-by-day delivery per campaign or ad, for fatigue detection. */
  getDailySeries(query: OutcomeQuery): Promise<DailySeries[]>;
}

export function createFakeOutcomeProvider(data: { rows?: OutcomeRow[]; series?: DailySeries[]; asOf?: string | null; currency?: string | null; notes?: string[] }): CampaignOutcomeProvider {
  return {
    name: "fake",
    async getOutcomes(q) {
      return { rows: (data.rows ?? []).filter((r) => r.level === q.level && (!q.channel || r.channel === q.channel)), currency: data.currency ?? "INR", asOf: data.asOf ?? null, notes: data.notes ?? [] };
    },
    async getDailySeries(q) {
      return (data.series ?? []).filter((s) => s.level === q.level && (!q.channel || s.channel === q.channel));
    },
  };
}

export type AdLead = { adKey: string; kycApproved: boolean; funded: boolean; revenue: number };
type RawLead = { attribution: Record<string, unknown> | null; kycApproved: boolean; funded: boolean; revenue: number };

const str = (a: Record<string, unknown> | null, k: string): string | null => {
  const v = a?.[k];
  return typeof v === "string" && v.trim() && v.length <= 300 ? v.trim() : null;
};

/**
 * Matches leads to ads: `ad_id` (a lead form passes it) first, then `utm_content` as an ad id or as a unique ad name. A name
 * shared by two ads matches nothing, and a lead that matches no ad is left out: a guess would pollute the ranking.
 */
export function attributeLeadsToAds(leads: RawLead[], ads: { adId: string; adName: string }[]): AdLead[] {
  const ids = new Set(ads.map((a) => a.adId));
  const byName = new Map<string, string[]>();
  for (const a of ads) {
    const key = normalizeCampaignName(a.adName);
    byName.set(key, [...(byName.get(key) ?? []), a.adId]);
  }
  const out: AdLead[] = [];
  for (const l of leads) {
    const adId = str(l.attribution, "ad_id");
    const content = str(l.attribution, "utm_content");
    let key: string | null = null;
    if (adId && ids.has(adId)) key = adId;
    else if (!adId && content) {
      if (ids.has(content)) key = content;
      else {
        const named = byName.get(normalizeCampaignName(content));
        if (named && named.length === 1) key = named[0];
      }
    }
    if (key) out.push({ adKey: key, kycApproved: l.kycApproved, funded: l.funded, revenue: l.revenue });
  }
  return out;
}

export type SimpleOutcomeDeps = {
  loadReports(from: string, to: string): Promise<{ channel: AdChannel; report: MarketingReport | null; asOf: Date | null }[]>;
  loadAdDaily(from: string, to: string): Promise<CreativeDayRow[]>;
  loadCampaignDaily(from: string, to: string): Promise<{ channel: AdChannel; campaignId: string; campaignName: string; date: string; spendMinor: number; currency: string; impressions: number; clicks: number; reach: number; leads: number }[]>;
  loadAdLeads(from: string, to: string): Promise<AdLead[]>;
};

export function createSimpleOutcomeProvider(deps: SimpleOutcomeDeps): CampaignOutcomeProvider {
  return {
    name: "simple",
    async getOutcomes(q) {
      const reports = (await deps.loadReports(q.from, q.to)).filter((r) => !q.channel || r.channel === q.channel);
      const asOfDate = reports.map((r) => r.asOf).filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const asOf = asOfDate ? asOfDate.toISOString() : null;
      const notes: string[] = ["Contacted-in-time counts are not available yet; they arrive with the attribution module."];

      if (q.level === "campaign") {
        const rows: OutcomeRow[] = [];
        let currency: string | null = null;
        for (const { channel, report } of reports) {
          if (!report) continue;
          currency = currency ?? report.currency;
          for (const c of report.campaigns) {
            rows.push({ level: "campaign", channel, campaignId: c.campaignId, campaignName: c.name, adId: null, adName: null, format: null, spend: c.spend, currency: report.currency, impressions: c.impressions, clicks: c.clicks, platformLeads: c.metaLeads, leads: c.crmLeads, contactedInSla: null, kyc: c.kyc, funded: c.funded, revenue: c.revenue, outcomes: "crm" });
          }
        }
        return { rows, currency, asOf, notes };
      }

      const adRows = (await deps.loadAdDaily(q.from, q.to)).filter((r) => !q.channel || r.channel === q.channel);
      const report = buildCreativeReport(adRows);
      const leads = await deps.loadAdLeads(q.from, q.to);
      const hasIds = leads.length > 0;
      if (!hasIds) notes.push("Ad-level funded counts need an ad id on each lead (the ad_id or utm_content field). None was found, so ads show the platform's own numbers only.");
      if (report.otherCurrencyRows > 0) notes.push(`${report.otherCurrencyRows} ad rows in another currency were left out.`);
      const by = new Map<string, { leads: number; kyc: number; funded: number; revenue: number }>();
      for (const l of leads) {
        const a = by.get(l.adKey) ?? { leads: 0, kyc: 0, funded: 0, revenue: 0 };
        a.leads++;
        if (l.kycApproved) a.kyc++;
        if (l.funded) a.funded++;
        a.revenue += l.revenue;
        by.set(l.adKey, a);
      }
      const rows: OutcomeRow[] = report.ads.map((a) => {
        const o = by.get(a.adId);
        return {
          level: "ad", channel: a.channel, campaignId: a.campaignId, campaignName: a.campaignName, adId: a.adId, adName: a.adName, format: a.format || null,
          spend: a.spend, currency: report.currency, impressions: a.impressions, clicks: a.clicks, platformLeads: a.leads,
          leads: hasIds ? (o?.leads ?? 0) : null, contactedInSla: null, kyc: hasIds ? (o?.kyc ?? 0) : null, funded: hasIds ? (o?.funded ?? 0) : null, revenue: hasIds ? (o?.revenue ?? 0) : null,
          outcomes: hasIds ? "crm" : "platform_only",
        };
      });
      return { rows, currency: report.currency, asOf, notes };
    },

    async getDailySeries(q) {
      const major = (minor: number, currency: string) => minor / 10 ** currencyExponent(currency);
      if (q.level === "ad") {
        const rows = (await deps.loadAdDaily(q.from, q.to)).filter((r) => !q.channel || r.channel === q.channel);
        const by = new Map<string, DailySeries>();
        for (const r of rows) {
          const key = `${r.channel}:${r.adId}`;
          const s = by.get(key) ?? { channel: r.channel, level: "ad" as const, campaignId: r.campaignId, adId: r.adId, name: r.adName, points: [] };
          s.name = r.adName;
          s.points.push({ date: r.date, impressions: r.impressions, clicks: r.clicks, spend: major(r.spendMinor, r.currency), leads: r.leads, reach: null });
          by.set(key, s);
        }
        return [...by.values()];
      }
      const rows = (await deps.loadCampaignDaily(q.from, q.to)).filter((r) => !q.channel || r.channel === q.channel);
      const by = new Map<string, DailySeries>();
      for (const r of rows) {
        const key = `${r.channel}:${r.campaignId}`;
        const s = by.get(key) ?? { channel: r.channel, level: "campaign" as const, campaignId: r.campaignId, adId: null, name: r.campaignName, points: [] };
        s.name = r.campaignName;
        s.points.push({ date: r.date, impressions: r.impressions, clicks: r.clicks, spend: major(r.spendMinor, r.currency), leads: r.leads, reach: r.reach });
        by.set(key, s);
      }
      return [...by.values()];
    },
  };
}
