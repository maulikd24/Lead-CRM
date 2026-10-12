import type { AdChannel } from "../channels";
import { AdsApiError } from "../ads-error";
import { addDays, dayDiff } from "../dates";
import { currencyExponent } from "../money";
import type { AccountInfo, AdReportingProvider, CreativeInsightRow, InsightRow, WindowParams } from "./types";

/**
 * A fake ad platform for tests and demos. Deterministic (no randomness, no clock, no network) and synthetic: the same
 * window always gives the same rows, so screenshots and assertions are stable. It implements the same interface as the
 * real clients and can be told to fail with the same typed errors.
 */
export type FakeCampaign = {
  id: string;
  name: string;
  /** Average spend per day in major units (rupees). */
  dailySpend: number;
  /** Clicks per impression. */
  ctr: number;
  /** Leads per click. */
  leadRate: number;
  /** Ad names; when present the campaign also reports per-ad rows. */
  ads?: string[];
};

export type FakeAdProviderSpec = {
  channel: AdChannel;
  account: AccountInfo;
  campaigns: FakeCampaign[];
  failWith?: Error;
  now?: () => number;
};

/** Small stable hash to [0, 1): enough variety day to day without any randomness. */
function wobble(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export function createFakeAdProvider(spec: FakeAdProviderSpec): AdReportingProvider {
  const exponent = currencyExponent(spec.account.currency);
  const now = spec.now ?? Date.now;

  function guard(params: WindowParams) {
    if (params.deadlineMs !== undefined && params.deadlineMs - now() <= 0) throw new AdsApiError("deadline", "The sync time budget was reached.");
    if (spec.failWith) throw spec.failWith;
  }

  function days(params: WindowParams): string[] {
    return Array.from({ length: Math.max(0, dayDiff(params.since, params.until) + 1) }, (_, i) => addDays(params.since, i));
  }

  function metricsFor(key: string, c: FakeCampaign, share: number) {
    const spendMajor = c.dailySpend * share * (0.7 + 0.6 * wobble(`${key}:spend`));
    const spendMinor = BigInt(Math.round(spendMajor * 10 ** exponent));
    const impressions = Math.max(1, Math.round((spendMajor / 0.15) * (0.8 + 0.4 * wobble(`${key}:imp`)))); // about 15 per thousand impressions
    const clicks = Math.min(impressions, Math.round(impressions * c.ctr * (0.8 + 0.4 * wobble(`${key}:clk`))));
    const leads = Math.min(clicks, Math.round(clicks * c.leadRate * (0.7 + 0.6 * wobble(`${key}:led`))));
    return { spendMinor, impressions, clicks, leads };
  }

  return {
    channel: spec.channel,
    async getAccount() {
      if (spec.failWith) throw spec.failWith;
      return spec.account;
    },
    async getInsights(params): Promise<InsightRow[]> {
      guard(params);
      return days(params).flatMap((date) =>
        spec.campaigns.map((c) => ({ campaignId: c.id, campaignName: c.name, date, currency: spec.account.currency, reach: 0, ...metricsFor(`${spec.channel}:${c.id}:${date}`, c, 1) })),
      );
    },
    async getCreativeInsights(params): Promise<CreativeInsightRow[]> {
      guard(params);
      return days(params).flatMap((date) =>
        spec.campaigns.flatMap((c) =>
          (c.ads ?? []).map((adName, i, all) => ({
            campaignId: c.id,
            campaignName: c.name,
            adId: `${c.id}-ad${i + 1}`,
            adName,
            format: "RESPONSIVE_SEARCH_AD",
            date,
            currency: spec.account.currency,
            ...metricsFor(`${spec.channel}:${c.id}:${adName}:${date}`, c, (1 + (all.length - i) * 0.3) / all.length / 1.3),
          })),
        ),
      );
    },
  };
}
