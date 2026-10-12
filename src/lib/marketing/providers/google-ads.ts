import { z } from "zod";

import { AdsApiError, type AdsErrorKind } from "../ads-error";
import { currencyExponent } from "../money";
import type { AccountInfo, AdReportingProvider, CreativeInsightRow, InsightRow, WindowParams } from "./types";

/**
 * Read-only client for the Google Ads API (reporting queries only).
 *
 * - The only calls are the OAuth token exchange and `googleAds:search` with a GAQL SELECT. Google's API takes queries
 *   as POST bodies; nothing here can create, change or pause anything, and there is no mutate call in this file.
 * - Secrets (developer token, client secret, refresh token, access token) go in headers or the POST body only: never
 *   in a URL, a log line or an error message. Error messages are built from status codes and fixed text.
 * - `fetch`, `sleep` and the clock are injected, so every behaviour is testable without a network.
 * - Responses are parsed strictly; a changed shape is a typed `schema` error, never silent zeros.
 *
 * Not verified against a live account (none was available): the first live run needs a check, especially that
 * `metrics.conversions` is the lead measure the account cares about and that the API version is still supported.
 */

/** Google Ads API versions are supported for roughly a year. Override per account in Settings ("API version"); bumping needs no deploy. */
export const DEFAULT_GOOGLE_ADS_VERSION = "v22";

const ADS_ORIGIN = "https://googleads.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function resolveGoogleAdsVersion(value: string | undefined | null): string {
  const match = /^v?(\d{1,2})$/.exec((value ?? "").trim());
  return match ? `v${match[1]}` : DEFAULT_GOOGLE_ADS_VERSION;
}

export class GoogleAdsError extends AdsApiError {
  constructor(kind: AdsErrorKind, message: string, extra: { status?: number; code?: number; retryAfterMs?: number } = {}) {
    super(kind, message, extra);
    this.name = "GoogleAdsError";
  }
}

export type GoogleAdsClientOptions = {
  /** The Google Ads customer (account) id; dashes are fine. */
  customerId: string;
  /** Optional manager (MCC) account id, sent as the login-customer-id header. */
  loginCustomerId?: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  apiVersion?: string;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxPages?: number;
  now?: () => number;
};

const digits = (value: string) => value.replace(/-/g, "").trim();
const intText = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => Number(v));
const costText = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const metricsSchema = z.object({
  costMicros: costText.default(BigInt(0)),
  impressions: intText.default(0),
  clicks: intText.default(0),
  conversions: z.number().nonnegative().default(0),
});
const campaignRowSchema = z.object({ campaign: z.object({ id: z.union([z.string(), z.number()]).optional(), name: z.string().default("") }), segments: z.object({ date }), metrics: metricsSchema.default({ costMicros: BigInt(0), impressions: 0, clicks: 0, conversions: 0 }) });
const adRowSchema = campaignRowSchema.extend({ adGroupAd: z.object({ ad: z.object({ id: z.union([z.string(), z.number()]).optional(), name: z.string().optional(), type: z.string().optional() }) }) });
const pageSchema = z.object({ results: z.array(z.unknown()).default([]), nextPageToken: z.string().optional() });
const customerSchema = z.object({ results: z.array(z.object({ customer: z.object({ descriptiveName: z.string().default(""), currencyCode: z.string().regex(/^[A-Z]{3}$/), timeZone: z.string().min(1) }) })).min(1) });
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().optional() });

/** Micros (1/1,000,000 of the currency unit) to minor units, exact, rounding half up. */
function microsToMinor(micros: bigint, currency: string): bigint {
  const drop = 6 - currencyExponent(currency);
  if (drop <= 0) return micros * BigInt(10) ** BigInt(-drop);
  const divisor = BigInt(10) ** BigInt(drop);
  return (micros + divisor / BigInt(2)) / divisor;
}

function retryAfter(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 3600) * 1000 : undefined;
}

function classify(res: Response, who: string): GoogleAdsError {
  const extra = { status: res.status, retryAfterMs: retryAfter(res) };
  const label = `HTTP ${res.status}`;
  if (res.status === 429) return new GoogleAdsError("rate_limit", `${who} rate limit reached (${label})`, extra);
  if (res.status === 401 || res.status === 403) return new GoogleAdsError("auth", `${who} rejected the credentials or their permissions (${label})`, extra);
  if (res.status >= 500) return new GoogleAdsError("transient", `${who} temporarily failed (${label})`, extra);
  return new GoogleAdsError("http", `${who} request failed (${label})`, extra);
}

export function createGoogleAdsClient(options: GoogleAdsClientOptions): AdReportingProvider & { version: string; getCreativeInsights(params: WindowParams): Promise<CreativeInsightRow[]> } {
  const customerId = digits(options.customerId);
  if (!/^\d{5,20}$/.test(customerId)) throw new GoogleAdsError("config", "The customer id is not valid (digits only, dashes allowed).");
  const loginCustomerId = options.loginCustomerId?.trim() ? digits(options.loginCustomerId) : undefined;
  if (loginCustomerId !== undefined && !/^\d{5,20}$/.test(loginCustomerId)) throw new GoogleAdsError("config", "The manager account id is not valid (digits only, dashes allowed).");
  const developerToken = options.developerToken.trim();
  const clientId = options.clientId.trim();
  const clientSecret = options.clientSecret.trim();
  const refreshToken = options.refreshToken.trim();
  if (!developerToken || !clientId || !clientSecret || !refreshToken) throw new GoogleAdsError("config", "The developer token, OAuth client id, client secret and refresh token are all required.");

  const version = resolveGoogleAdsVersion(options.apiVersion);
  const searchUrl = `${ADS_ORIGIN}/${version}/customers/${customerId}/googleAds:search`;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxPages = options.maxPages ?? 20;
  const now = options.now ?? Date.now;
  const MAX_RETRY_SLEEP_MS = 5000;

  let access: { token: string; expiresAt: number } | null = null;
  let account: AccountInfo | null = null;

  function budget(deadlineMs: number | undefined): number {
    if (deadlineMs === undefined) return timeoutMs;
    const left = deadlineMs - now();
    if (left <= 0) throw new GoogleAdsError("deadline", "The sync time budget was reached.");
    return Math.min(timeoutMs, left);
  }

  /** One request, one retry for a network blip or a 5xx. */
  async function send(url: string, init: RequestInit, who: string, deadlineMs?: number): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const allowed = budget(deadlineMs);
      let res: Response;
      try {
        res = await options.fetch(url, { ...init, signal: AbortSignal.timeout(allowed) });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "TimeoutError" || name === "AbortError") throw new GoogleAdsError("timeout", `${who} did not answer within ${Math.round(timeoutMs / 1000)}s.`);
        if (attempt === 0) {
          await sleep(500);
          continue;
        }
        throw new GoogleAdsError("transient", `Could not reach ${who} (network error).`);
      }
      if (res.ok) return res;
      const err = classify(res, who);
      if (err.kind === "transient" && attempt === 0) {
        await sleep(Math.min(err.retryAfterMs ?? 500, MAX_RETRY_SLEEP_MS));
        continue;
      }
      throw err;
    }
  }

  async function accessToken(deadlineMs?: number): Promise<string> {
    if (access && access.expiresAt - 60_000 > now()) return access.token;
    const body = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
    let res: Response;
    try {
      res = await send(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() }, "Google sign-in", deadlineMs);
    } catch (error) {
      // An invalid grant or client comes back as a 400/401: that is a credentials problem, not a generic failure.
      if (error instanceof GoogleAdsError && error.kind === "http") throw new GoogleAdsError("auth", "Google refused the OAuth credentials (refresh token, client id or secret).", error.extra);
      throw error;
    }
    let parsed;
    try {
      parsed = tokenSchema.safeParse(await res.json());
    } catch {
      parsed = null;
    }
    if (!parsed?.success) throw new GoogleAdsError("schema", "Google sign-in returned an unexpected response.");
    access = { token: parsed.data.access_token, expiresAt: now() + (parsed.data.expires_in ?? 3000) * 1000 };
    return access.token;
  }

  async function search(query: string, deadlineMs?: number): Promise<unknown[]> {
    const out: unknown[] = [];
    const seen = new Set<string>();
    let pageToken: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= maxPages) throw new GoogleAdsError("paging", `Stopped after ${maxPages} pages of results; the window is too large.`);
      const token = await accessToken(deadlineMs);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "developer-token": developerToken, "Content-Type": "application/json", Accept: "application/json" };
      if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
      const res = await send(searchUrl, { method: "POST", headers, body: JSON.stringify(pageToken ? { query, pageToken } : { query }) }, "Google Ads", deadlineMs);
      let body;
      try {
        body = pageSchema.safeParse(await res.json());
      } catch {
        body = null;
      }
      if (!body?.success) throw new GoogleAdsError("schema", "Google Ads returned a response that did not have the expected shape.");
      out.push(...body.data.results);
      pageToken = body.data.nextPageToken;
      if (!pageToken) return out;
      if (seen.has(pageToken)) throw new GoogleAdsError("paging", "Google Ads returned the same paging token twice.");
      seen.add(pageToken);
    }
  }

  function assertWindow(params: WindowParams) {
    // Dates go into the query text, so only a plain calendar date is allowed through.
    if (!date.safeParse(params.since).success || !date.safeParse(params.until).success) throw new GoogleAdsError("config", "The date window is not valid.");
  }

  async function getAccount(deadlineMs?: number): Promise<AccountInfo> {
    if (account) return account;
    const rows = await search("SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1", deadlineMs);
    const parsed = customerSchema.safeParse({ results: rows });
    if (!parsed.success) throw new GoogleAdsError("schema", "The account response did not have the expected fields.");
    const c = parsed.data.results[0].customer;
    account = { name: c.descriptiveName, currency: c.currencyCode, timezoneName: c.timeZone };
    return account;
  }

  const idOf = (value: string | number | undefined) => (value === undefined || String(value) === "" ? null : String(value));

  return {
    channel: "google",
    version,
    getAccount: () => getAccount(),

    async getInsights(params: WindowParams): Promise<InsightRow[]> {
      assertWindow(params);
      const { currency } = await getAccount(params.deadlineMs);
      const rows = await search(
        `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${params.since}' AND '${params.until}'`,
        params.deadlineMs,
      );
      const out: InsightRow[] = [];
      let skipped = 0;
      for (const raw of rows) {
        const parsed = campaignRowSchema.safeParse(raw);
        if (!parsed.success) throw new GoogleAdsError("schema", "A campaign row did not have the expected shape.");
        const id = idOf(parsed.data.campaign.id);
        if (!id) {
          skipped++;
          continue;
        }
        const m = parsed.data.metrics;
        out.push({ campaignId: id, campaignName: parsed.data.campaign.name, date: parsed.data.segments.date, spendMinor: microsToMinor(m.costMicros, currency), currency, impressions: m.impressions, clicks: m.clicks, reach: 0, leads: Math.round(m.conversions) });
      }
      if (skipped > 0) params.onSkip?.(skipped);
      return out;
    },

    async getCreativeInsights(params: WindowParams): Promise<CreativeInsightRow[]> {
      assertWindow(params);
      const { currency } = await getAccount(params.deadlineMs);
      const rows = await search(
        `SELECT campaign.id, campaign.name, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE segments.date BETWEEN '${params.since}' AND '${params.until}'`,
        params.deadlineMs,
      );
      const out: CreativeInsightRow[] = [];
      let skipped = 0;
      for (const raw of rows) {
        const parsed = adRowSchema.safeParse(raw);
        if (!parsed.success) throw new GoogleAdsError("schema", "An ad row did not have the expected shape.");
        const campaignId = idOf(parsed.data.campaign.id);
        const adId = idOf(parsed.data.adGroupAd.ad.id);
        if (!campaignId || !adId) {
          skipped++;
          continue;
        }
        const m = parsed.data.metrics;
        out.push({
          campaignId,
          campaignName: parsed.data.campaign.name,
          adId,
          adName: parsed.data.adGroupAd.ad.name?.trim() || `Ad ${adId}`,
          format: parsed.data.adGroupAd.ad.type ?? "",
          date: parsed.data.segments.date,
          spendMinor: microsToMinor(m.costMicros, currency),
          currency,
          impressions: m.impressions,
          clicks: m.clicks,
          leads: Math.round(m.conversions),
        });
      }
      if (skipped > 0) params.onSkip?.(skipped);
      return out;
    },
  };
}
