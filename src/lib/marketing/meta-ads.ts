import { z } from "zod";

import { parseMinorUnits } from "./money";

/**
 * Read-only client for the Meta Marketing API insights endpoint.
 *
 * - Only ever issues GET requests (account info + insights). No create/edit/publish call exists in this file.
 * - The access token is sent in the Authorization header and is never placed in a URL, logged, or put in an error.
 * - `fetch` and `sleep` are injected so every behaviour is testable without a network.
 * - Responses are parsed strictly; a changed shape is a typed `schema` error, never silent zeros.
 */

/**
 * Default Graph API version. Meta publishes a new version roughly every quarter and supports each for about two years
 * after release; v23.0 (released May 2025) is a stable, still-supported choice. It can be overridden per account in
 * Settings (field "API version") without a code change, so bumping it later needs no deploy.
 */
export const DEFAULT_GRAPH_VERSION = "v23.0";

const GRAPH_ORIGIN = "https://graph.facebook.com";

/** Accepts "v23.0" or "23.0"; anything else (including path tricks) falls back to the default. */
export function resolveGraphVersion(value: string | undefined | null): string {
  const text = (value ?? "").trim();
  const match = /^v?(\d{1,3}\.\d{1,2})$/.exec(text);
  return match ? `v${match[1]}` : DEFAULT_GRAPH_VERSION;
}

export type MetaAdsErrorKind = "config" | "deadline" | "rate_limit" | "auth" | "transient" | "timeout" | "schema" | "paging" | "http";

export class MetaAdsError extends Error {
  constructor(
    public readonly kind: MetaAdsErrorKind,
    message: string,
    public readonly extra: { status?: number; code?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "MetaAdsError";
  }
  get status() {
    return this.extra.status;
  }
  get code() {
    return this.extra.code;
  }
  get retryAfterMs() {
    return this.extra.retryAfterMs;
  }
}

export type AccountInfo = { name: string; currency: string; timezoneName: string };

export type InsightRow = {
  campaignId: string;
  campaignName: string;
  adsetId?: string;
  adsetName?: string;
  /** Calendar day in the ad account's timezone, YYYY-MM-DD. */
  date: string;
  spendMinor: bigint;
  currency: string;
  impressions: number;
  clicks: number;
  reach: number;
  leads: number;
};

export type MetaAdsClientOptions = {
  accountId: string;
  accessToken: string;
  apiVersion?: string;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxPages?: number;
  /** Clock in epoch ms; injected so deadlines are testable. */
  now?: () => number;
  /** Used when a row carries no account_currency. */
  defaultCurrency?: string;
  baseUrl?: string;
};

const intString = z.string().regex(/^\d+$/);
const insightSchema = z.object({
  campaign_id: z.string().min(1),
  campaign_name: z.string(),
  adset_id: z.string().optional(),
  adset_name: z.string().optional(),
  spend: z.string().regex(/^\d+(\.\d+)?$/),
  impressions: intString.default("0"),
  clicks: intString.default("0"),
  reach: intString.default("0"),
  actions: z.array(z.object({ action_type: z.string(), value: z.string() })).optional(),
  account_currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const pageSchema = z.object({ data: z.array(z.unknown()), paging: z.object({ next: z.string().optional() }).optional() });
const accountSchema = z.object({ name: z.string(), currency: z.string().regex(/^[A-Z]{3}$/), timezone_name: z.string().min(1) });
const errorBodySchema = z.object({ error: z.object({ code: z.number().optional(), type: z.string().optional() }).optional() });

/** "lead" is Meta's aggregate; the others are fallbacks. Only one is used so a lead is never counted twice. */
const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"];

function leadsFrom(actions: { action_type: string; value: string }[] | undefined): number {
  for (const type of LEAD_ACTIONS) {
    const hit = actions?.find((a) => a.action_type === type);
    if (hit) return /^\d+$/.test(hit.value) ? Number(hit.value) : 0;
  }
  return 0;
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
function isRateLimitCode(code: number | undefined): boolean {
  return code !== undefined && (RATE_LIMIT_CODES.has(code) || (code >= 80000 && code <= 80014));
}
function isAuthCode(code: number | undefined): boolean {
  return code !== undefined && (code === 190 || code === 102 || code === 10 || (code >= 200 && code <= 299));
}

function retryAfter(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 3600) * 1000 : undefined;
}

async function classify(res: Response): Promise<MetaAdsError> {
  let code: number | undefined;
  let type: string | undefined;
  try {
    const parsed = errorBodySchema.safeParse(await res.json());
    code = parsed.success ? parsed.data.error?.code : undefined;
    type = parsed.success ? parsed.data.error?.type : undefined;
  } catch {
    // body was not JSON; classify on status alone
  }
  const extra = { status: res.status, code, retryAfterMs: retryAfter(res) };
  // Messages are built here from numeric codes only: Meta's own message text and body are never copied.
  const label = `HTTP ${res.status}${code !== undefined ? `, code ${code}` : ""}${type ? `, ${type.replace(/[^A-Za-z]/g, "").slice(0, 40)}` : ""}`;
  if (res.status === 429 || isRateLimitCode(code)) return new MetaAdsError("rate_limit", `Meta rate limit reached (${label})`, extra);
  if (res.status === 401 || res.status === 403 || isAuthCode(code)) return new MetaAdsError("auth", `Meta rejected the access token or its permissions (${label})`, extra);
  if (res.status >= 500 || code === 1 || code === 2) return new MetaAdsError("transient", `Meta temporarily failed (${label})`, extra);
  return new MetaAdsError("http", `Meta request failed (${label})`, extra);
}

export function createMetaAdsClient(options: MetaAdsClientOptions) {
  const accountId = options.accountId.trim().replace(/^act_/, "");
  if (!/^\d{5,20}$/.test(accountId)) throw new MetaAdsError("config", "The ad account id is not valid (digits only, optionally prefixed act_).");
  if (!options.accessToken.trim()) throw new MetaAdsError("config", "No access token is configured.");

  const token = options.accessToken.trim();
  const version = resolveGraphVersion(options.apiVersion);
  const origin = options.baseUrl ?? GRAPH_ORIGIN;
  const accountPath = `/${version}/act_${accountId}`;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxPages = options.maxPages ?? 10;
  const now = options.now ?? Date.now;
  const MAX_RETRY_SLEEP_MS = 5000;

  /** Throws a "deadline" error if the absolute deadline (epoch ms) has passed; otherwise returns the ms left (or the plain timeout). */
  function budget(deadlineMs: number | undefined): number {
    if (deadlineMs === undefined) return timeoutMs;
    const left = deadlineMs - now();
    if (left <= 0) throw new MetaAdsError("deadline", "The sync time budget was reached.");
    return Math.min(timeoutMs, left);
  }

  async function get(url: string, deadlineMs?: number): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      const allowed = budget(deadlineMs);
      try {
        res = await options.fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(allowed) });
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "TimeoutError" || name === "AbortError") throw new MetaAdsError("timeout", `Meta did not answer within ${Math.round(timeoutMs / 1000)}s.`);
        if (attempt === 0) {
          await sleep(500);
          continue;
        }
        throw new MetaAdsError("transient", "Could not reach Meta (network error).");
      }
      if (res.ok) return res;
      const err = await classify(res);
      if (err.kind === "transient" && attempt === 0) {
        await sleep(Math.min(err.retryAfterMs ?? 500, MAX_RETRY_SLEEP_MS));
        continue;
      }
      throw err;
    }
  }

  async function json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new MetaAdsError("schema", "Meta returned a response that is not valid JSON.");
    }
  }

  /** A paging link is followed only if it is https, on the same host and under this account's insights path. The token is dropped from it. */
  function safeNext(next: string): string {
    let url: URL;
    try {
      url = new URL(next);
    } catch {
      throw new MetaAdsError("paging", "Meta returned an unusable paging link.");
    }
    const base = new URL(origin);
    if (url.protocol !== "https:" || url.host !== base.host || url.pathname !== `${accountPath}/insights`) {
      throw new MetaAdsError("paging", "Meta returned a paging link to an unexpected address; it was not followed.");
    }
    url.searchParams.delete("access_token");
    return url.toString();
  }

  return {
    version,

    /** Minimal read-only call used to verify credentials and learn the account's currency and timezone. */
    async getAccount(): Promise<AccountInfo> {
      const url = `${origin}${accountPath}?fields=${encodeURIComponent("name,currency,timezone_name")}`;
      const parsed = accountSchema.safeParse(await json(await get(url)));
      if (!parsed.success) throw new MetaAdsError("schema", "The ad account response did not have the expected fields.");
      return { name: parsed.data.name, currency: parsed.data.currency, timezoneName: parsed.data.timezone_name };
    },

    /** Daily insights for an inclusive window of account-local dates, following paging safely. */
    async getInsights(params: { since: string; until: string; level?: "campaign" | "adset"; deadlineMs?: number; onSkip?: (count: number) => void }): Promise<InsightRow[]> {
      const level = params.level ?? "campaign";
      const fields = ["campaign_id", "campaign_name", ...(level === "adset" ? ["adset_id", "adset_name"] : []), "spend", "impressions", "clicks", "reach", "actions", "account_currency"].join(",");
      const first = new URL(`${origin}${accountPath}/insights`);
      first.searchParams.set("level", level);
      first.searchParams.set("fields", fields);
      first.searchParams.set("time_increment", "1");
      first.searchParams.set("time_range", JSON.stringify({ since: params.since, until: params.until }));
      first.searchParams.set("limit", "500");

      const rows: InsightRow[] = [];
      const seen = new Set<string>();
      let url: string | undefined = first.toString();
      for (let page = 0; url; page++) {
        if (page >= maxPages) throw new MetaAdsError("paging", `Stopped after ${maxPages} pages of insights; the window is too large.`);
        if (seen.has(url)) throw new MetaAdsError("paging", "Meta returned the same paging link twice.");
        seen.add(url);

        const body = pageSchema.safeParse(await json(await get(url, params.deadlineMs)));
        if (!body.success) throw new MetaAdsError("schema", "The insights response did not have the expected shape.");
        let skippedHere = 0;
        for (const raw of body.data.data) {
          // A row with no campaign id cannot be attributed to anything: skip it and carry on rather than fail the window.
          if (typeof raw !== "object" || raw === null || typeof (raw as { campaign_id?: unknown }).campaign_id !== "string" || (raw as { campaign_id: string }).campaign_id === "") {
            skippedHere++;
            continue;
          }
          const parsed = insightSchema.safeParse(raw);
          if (!parsed.success) throw new MetaAdsError("schema", "An insights row did not have the expected fields.");
          const r = parsed.data;
          const currency = r.account_currency ?? options.defaultCurrency;
          if (!currency) throw new MetaAdsError("schema", "An insights row carried no currency and none is known for the account.");
          rows.push({
            campaignId: r.campaign_id,
            campaignName: r.campaign_name,
            ...(r.adset_id ? { adsetId: r.adset_id, adsetName: r.adset_name } : {}),
            date: r.date_start,
            spendMinor: parseMinorUnits(r.spend, currency),
            currency,
            impressions: Number(r.impressions),
            clicks: Number(r.clicks),
            reach: Number(r.reach),
            leads: leadsFrom(r.actions),
          });
        }
        if (skippedHere > 0) params.onSkip?.(skippedHere);
        const next = body.data.paging?.next;
        url = next ? safeNext(next) : undefined;
      }
      return rows;
    },
  };
}

export type MetaAdsClient = ReturnType<typeof createMetaAdsClient>;
