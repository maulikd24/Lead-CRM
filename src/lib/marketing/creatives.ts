import type { AdChannel } from "./channels";
import { currencyExponent } from "./money";

/**
 * Per-ad ("creative") performance from AdCreativeDaily. Pure.
 *
 * Leads here are the platform's own count. The CRM can only attribute a lead to a campaign (that is all a lead form
 * or a UTM carries), so ad-level cost per lead is the platform's view, not the CRM's: it is labelled that way on screen.
 */

export type CreativeDayRow = {
  channel: AdChannel;
  campaignId: string;
  campaignName: string;
  adId: string;
  adName: string;
  format: string;
  date: string;
  /** Minor units, as stored. */
  spendMinor: number;
  currency: string;
  impressions: number;
  clicks: number;
  leads: number;
};

export const MIN_LEADS_FOR_CREATIVE_VERDICT = 5;

export type CreativeRow = {
  channel: AdChannel;
  adId: string;
  adName: string;
  format: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  days: number;
  ctr: number | null;
  cpc: number | null;
  cpl: number | null;
  /** "best" / "worst" cost per lead among ads with enough leads to compare; otherwise null. */
  verdict: "best" | "worst" | null;
};

export type CreativeReport = {
  currency: string | null;
  ads: CreativeRow[];
  totals: { ads: number; spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; cpl: number | null };
  otherCurrencyRows: number;
};

const div = (a: number, b: number): number | null => (b > 0 && Number.isFinite(a / b) ? a / b : null);

export function buildCreativeReport(rows: CreativeDayRow[]): CreativeReport {
  const stats = new Map<string, { rows: number; minor: number }>();
  for (const r of rows) {
    const s = stats.get(r.currency) ?? { rows: 0, minor: 0 };
    s.rows++;
    s.minor += r.spendMinor;
    stats.set(r.currency, s);
  }
  const currency = [...stats.entries()].sort((a, b) => b[1].rows - a[1].rows || b[1].minor - a[1].minor)[0]?.[0] ?? null;
  const used = rows.filter((r) => r.currency === currency);
  const exponent = currency ? currencyExponent(currency) : 2;
  const major = (minor: number) => minor / 10 ** exponent;

  const byAd = new Map<string, { row: CreativeDayRow; spendMinor: number; impressions: number; clicks: number; leads: number; days: Set<string> }>();
  for (const r of used) {
    const key = `${r.channel}:${r.adId}`;
    const acc = byAd.get(key) ?? { row: r, spendMinor: 0, impressions: 0, clicks: 0, leads: 0, days: new Set<string>() };
    acc.spendMinor += r.spendMinor;
    acc.impressions += r.impressions;
    acc.clicks += r.clicks;
    acc.leads += r.leads;
    acc.days.add(r.date);
    if (r.date >= acc.row.date) acc.row = r; // newest names win
    byAd.set(key, acc);
  }

  const ads: CreativeRow[] = [...byAd.values()]
    .map((a) => {
      const spend = major(a.spendMinor);
      return {
        channel: a.row.channel,
        adId: a.row.adId,
        adName: a.row.adName,
        format: a.row.format,
        campaignId: a.row.campaignId,
        campaignName: a.row.campaignName,
        spend,
        impressions: a.impressions,
        clicks: a.clicks,
        leads: a.leads,
        days: a.days.size,
        ctr: div(a.clicks, a.impressions),
        cpc: div(spend, a.clicks),
        cpl: div(spend, a.leads),
        verdict: null as CreativeRow["verdict"],
      };
    })
    .sort((x, y) => y.spend - x.spend || y.leads - x.leads);

  const comparable = ads.filter((a) => a.leads >= MIN_LEADS_FOR_CREATIVE_VERDICT && a.cpl !== null).sort((x, y) => (x.cpl as number) - (y.cpl as number));
  if (comparable.length >= 2) {
    comparable[0].verdict = "best";
    comparable[comparable.length - 1].verdict = "worst";
  }

  const spend = ads.reduce((s, a) => s + a.spend, 0);
  const impressions = ads.reduce((s, a) => s + a.impressions, 0);
  const clicks = ads.reduce((s, a) => s + a.clicks, 0);
  const leads = ads.reduce((s, a) => s + a.leads, 0);
  return { currency, ads, totals: { ads: ads.length, spend, impressions, clicks, leads, ctr: div(clicks, impressions), cpl: div(spend, leads) }, otherCurrencyRows: rows.length - used.length };
}
