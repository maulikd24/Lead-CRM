import type { CustomerIdentity } from "./mapper";

/**
 * Pull-model skeleton. The back-office API contract is not agreed yet, so the paths below are placeholders; the point
 * of this file is the seam: both the push route and a future pull job produce the same customer entry
 * ({ customer, holdings, transactions }) and hand it to ingestPortfolioBatch, so the UI never changes.
 * Nothing here runs unless PORTFOLIO_FEED_ENABLED is on, and nothing is wired to a schedule yet.
 */

export type BackOfficeCustomerRef = Pick<CustomerIdentity, "clientCode" | "pan" | "email"> & { mobile?: string };
export type BackOfficeFailure = "disabled" | "unauthorized" | "not_found" | "rate_limited" | "unavailable" | "invalid_response" | "invalid_request";
export type BackOfficeResult<T> = { ok: true; data: T } | { ok: false; reason: BackOfficeFailure };

/** Rows in the push contract's shape (validated later by mapCustomerEntry, exactly like pushed rows). */
export type HoldingRow = Record<string, unknown>;
export type TransactionRowIn = Record<string, unknown>;

export interface BackOfficeClient {
  getHoldings(ref: BackOfficeCustomerRef): Promise<BackOfficeResult<HoldingRow[]>>;
  getTransactions(ref: BackOfficeCustomerRef, opts?: { since?: Date }): Promise<BackOfficeResult<TransactionRowIn[]>>;
}

export type BackOfficeConfig = { baseUrl: string; token: string };

/** Same shape as other providers: non-secret `settings` (base URL) and decrypted `credentials` (token) from IntegrationConfig. */
export function parseBackOfficeConfig(input: { settings: Record<string, unknown> | null | undefined; credentials: Record<string, unknown> | null | undefined; flagOn: boolean }):
  | { ok: true; config: BackOfficeConfig }
  | { ok: false; reason: "disabled" | "invalid_base_url" | "missing_token" } {
  if (!input.flagOn) return { ok: false, reason: "disabled" };
  const raw = input.settings?.baseUrl;
  let url: URL | null = null;
  try {
    url = typeof raw === "string" ? new URL(raw) : null;
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:") return { ok: false, reason: "invalid_base_url" };
  const token = input.credentials?.token;
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing_token" };
  return { ok: true, config: { baseUrl: url.toString().replace(/\/+$/, ""), token } };
}

const STATUS_REASON: Record<number, BackOfficeFailure> = { 401: "unauthorized", 403: "unauthorized", 404: "not_found", 429: "rate_limited" };

export function createHttpBackOfficeClient(opts: BackOfficeConfig & { fetch: typeof fetch; timeoutMs?: number }): BackOfficeClient {
  async function get<T>(path: string, key: string): Promise<BackOfficeResult<T[]>> {
    let res: Response;
    try {
      res = await opts.fetch(`${opts.baseUrl}${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${opts.token}`, accept: "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    if (!res.ok) return { ok: false, reason: STATUS_REASON[res.status] ?? "unavailable" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "invalid_response" };
    }
    const rows = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
    return Array.isArray(rows) ? { ok: true, data: rows as T[] } : { ok: false, reason: "invalid_response" };
  }

  // The customer is addressed by its Allvest client code. Other identifiers are not sent in URLs (privacy).
  const customerPath = (ref: BackOfficeCustomerRef) => (ref.clientCode && /^[A-Za-z0-9-]+$/.test(ref.clientCode) ? `/v1/customers/${ref.clientCode}` : null);

  return {
    async getHoldings(ref) {
      const base = customerPath(ref);
      if (!base) return { ok: false, reason: "invalid_request" };
      return get<HoldingRow>(`${base}/holdings`, "holdings");
    },
    async getTransactions(ref, o) {
      const base = customerPath(ref);
      if (!base) return { ok: false, reason: "invalid_request" };
      const query = o?.since ? `?since=${encodeURIComponent(o.since.toISOString())}` : "";
      return get<TransactionRowIn>(`${base}/transactions${query}`, "transactions");
    },
  };
}

/** Pulls one customer and returns the entry shape the push route accepts. */
export async function pullCustomerEntry(
  client: BackOfficeClient,
  ref: BackOfficeCustomerRef,
  opts?: { since?: Date },
): Promise<{ ok: true; entry: { customer: BackOfficeCustomerRef; holdings: HoldingRow[]; transactions: TransactionRowIn[] } } | { ok: false; reason: BackOfficeFailure }> {
  const holdings = await client.getHoldings(ref);
  if (!holdings.ok) return holdings;
  const transactions = await client.getTransactions(ref, opts);
  if (!transactions.ok) return transactions;
  return { ok: true, entry: { customer: ref, holdings: holdings.data, transactions: transactions.data } };
}
