import type { AdChannel } from "../channels";

/**
 * What the reporting sync needs from an ad platform. Meta's client and Google's client both satisfy it, and so does
 * the fake used by tests and demos, so the sync, the matching and the page never know which one they are talking to.
 * Every method is a read: there is no create, edit, budget or publish call anywhere in this interface.
 */
export type AccountInfo = { name: string; currency: string; timezoneName: string };

export type InsightRow = {
  campaignId: string;
  campaignName: string;
  adsetId?: string;
  adsetName?: string;
  /** Calendar day in the ad account's timezone, YYYY-MM-DD. */
  date: string;
  /** Integer minor units (paise, cents) of `currency`. */
  spendMinor: bigint;
  currency: string;
  impressions: number;
  clicks: number;
  reach: number;
  /** Leads or conversions as the platform counts them. */
  leads: number;
};

/** One ad (creative) on one day. Ad-level leads are the platform's own count: the CRM can only attribute to a campaign. */
export type CreativeInsightRow = {
  campaignId: string;
  campaignName: string;
  adId: string;
  adName: string;
  /** Platform ad format, e.g. RESPONSIVE_SEARCH_AD. Free text, may be empty. */
  format: string;
  date: string;
  spendMinor: bigint;
  currency: string;
  impressions: number;
  clicks: number;
  leads: number;
};

export type WindowParams = { since: string; until: string; deadlineMs?: number; onSkip?: (count: number) => void };

export interface AdReportingProvider {
  readonly channel: AdChannel;
  getAccount(): Promise<AccountInfo>;
  getInsights(params: WindowParams): Promise<InsightRow[]>;
  /** Optional: platforms that can report per ad. */
  getCreativeInsights?(params: WindowParams): Promise<CreativeInsightRow[]>;
}
