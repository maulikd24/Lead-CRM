import type { z } from "zod";

import {
  envelopeSchema,
  refereePageSchema,
  referrerDetailSchema,
  referrerPageSchema,
  summarySchema,
  withdrawalPageSchema,
  type Page,
  type Referee,
  type Referrer,
  type ReferrerDetail,
  type Summary,
  type WithdrawalPage,
} from "./schemas";

/**
 * Typed, READ-ONLY client for the referral API's admin audience. Phase A of the Partner workspace:
 * GET requests only, no write method exists on this object. fetch is injected so every behaviour is
 * tested without a network. Tokens and response bodies are never logged or placed in error messages.
 */

export type ReferralApiErrorKind =
  | "not_configured"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "server"
  | "timeout"
  | "network"
  | "invalid_response";

const MESSAGES: Record<ReferralApiErrorKind, string> = {
  not_configured: "The referral API is not connected.",
  unauthorized: "The referral API did not accept the saved credential.",
  forbidden: "The saved credential does not have permission for this data.",
  not_found: "That record was not found.",
  bad_request: "The referral API did not accept the request.",
  rate_limited: "The referral API is rate limiting requests.",
  server: "The referral API had a problem.",
  timeout: "The referral API took too long to answer.",
  network: "The referral API could not be reached.",
  invalid_response: "The referral API answered in an unexpected shape.",
};

export class ReferralApiError extends Error {
  constructor(
    public readonly kind: ReferralApiErrorKind,
    public readonly status?: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(MESSAGES[kind]);
    this.name = "ReferralApiError";
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https only (plain http only for loopback, for local development), no embedded credentials. Returns the base without a trailing slash. */
export function assertSafeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ReferralApiError("not_configured");
  }
  const okScheme = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!okScheme || url.username || url.password) throw new ReferralApiError("not_configured");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export type ListParams = { limit?: number; offset?: number; search?: string; sort?: string };
export type ReferrerFilters = ListParams & { status?: string; kycStatus?: string };
export type RefereeFilters = ListParams & { referrerId?: string; funnelStatus?: string };
export type WithdrawalFilters = ListParams & { status?: string; referrerId?: string };

export interface ReferralApiPort {
  getSummary(): Promise<Summary>;
  listReferrers(f: ReferrerFilters): Promise<Page<Referrer>>;
  getReferrer(id: string): Promise<ReferrerDetail>;
  listReferees(f: RefereeFilters): Promise<Page<Referee>>;
  listWithdrawals(f: WithdrawalFilters): Promise<WithdrawalPage>;
  ping(): Promise<{ ok: boolean; message?: string }>;
}

export type ReferralApiClientOptions = {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const PREFIX = "/api/v1/admin";

function clamp(n: number | undefined, min: number, max: number, fallback: number) {
  if (n === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function query(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function listQuery(f: ListParams & Record<string, string | number | undefined>) {
  const { limit, offset, search, ...rest } = f;
  return query({
    limit: clamp(limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    offset: clamp(offset, 0, Number.MAX_SAFE_INTEGER, 0),
    q: search?.trim() || undefined,
    ...rest,
  });
}

function kindForStatus(status: number): ReferralApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

function kindForCode(code: number): ReferralApiErrorKind | null {
  if (code === 4001 || code === 4010) return "unauthorized";
  if (code === 4003) return "forbidden";
  if (code === 4004) return "not_found";
  if (code >= 5000) return "server";
  if (code >= 4000) return "bad_request";
  return null;
}

export function createReferralApiClient(opts: ReferralApiClientOptions): ReferralApiPort {
  const base = assertSafeBaseUrl(opts.baseUrl);
  if (!opts.token) throw new ReferralApiError("not_configured");
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function get<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}${PREFIX}${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${opts.token}`, accept: "application/json" },
        redirect: "error",
        signal: ctrl.signal,
        cache: "no-store",
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      throw new ReferralApiError(aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    const env = envelopeSchema.safeParse(body);
    const code = env.success ? env.data.code : undefined;

    if (!res.ok) {
      const byCode = code !== undefined ? kindForCode(code) : null;
      const kind = res.status === 400 && byCode && byCode !== "bad_request" ? byCode : kindForStatus(res.status);
      const retry = Number(res.headers.get("retry-after"));
      throw new ReferralApiError(kind, res.status, Number.isFinite(retry) && retry > 0 ? retry : undefined);
    }
    if (!env.success) throw new ReferralApiError("invalid_response", res.status);
    const codeKind = code !== undefined ? kindForCode(code) : null;
    if (codeKind) throw new ReferralApiError(codeKind, res.status);

    const parsed = schema.safeParse(env.data.data);
    // The issues are dropped on purpose: they can quote response content.
    if (!parsed.success) throw new ReferralApiError("invalid_response", res.status);
    return parsed.data;
  }

  return {
    getSummary: () => get("/reports/summary", summarySchema),
    listReferrers: (f) => get(`/referrers${listQuery({ ...f })}`, referrerPageSchema),
    getReferrer: (id) => get(`/referrers/${encodeURIComponent(id)}`, referrerDetailSchema),
    listReferees: (f) => get(`/referees${listQuery({ ...f })}`, refereePageSchema),
    listWithdrawals: (f) => get(`/withdrawals${listQuery({ ...f })}`, withdrawalPageSchema),
    async ping() {
      try {
        await get("/reports/summary", summarySchema);
        return { ok: true };
      } catch (e) {
        const kind = e instanceof ReferralApiError ? e.kind : "network";
        return { ok: false, message: PING_MESSAGES[kind] ?? MESSAGES[kind] };
      }
    },
  };
}

const PING_MESSAGES: Partial<Record<ReferralApiErrorKind, string>> = {
  unauthorized: "The referral API rejected the credential. Check the token.",
  forbidden: "Connected, but the credential has no permission to read this data. Ask for the view-only groups.",
  network: "Could not reach the referral API. Check the base URL and network allow-list.",
  timeout: "The referral API did not answer in time.",
  invalid_response: "Connected, but the response was not in the expected shape.",
};

/** Walks every page by offset until the reported total is reached, or maxPages pages have been read. */
export async function collectAllPages<T>(
  fetchPage: (offset: number) => Promise<Page<T>>,
  pageSize: number,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(offset);
    out.push(...page.items);
    offset += pageSize;
    if (page.items.length === 0 || offset >= page.total) break;
  }
  return out;
}
