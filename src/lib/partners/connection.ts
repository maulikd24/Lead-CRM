import { assertSafeBaseUrl, ReferralApiError } from "./referral-api";

export const REFERRAL_API_PROVIDER = "referral_api";

export type Connection = { state: "mock" } | { state: "not_connected" } | { state: "live"; baseUrl: string; token: string };

type Row = { mode: string; isEnabled: boolean; credentials: Record<string, unknown> };

/**
 * Decides how the workspace talks to the referral API from the saved integration row. Pure.
 * No row, or mock mode: synthetic data, no network. Live without a usable base URL and token: not connected.
 */
export function resolveConnection(row: Row | null): Connection {
  if (!row || row.mode !== "live") return { state: "mock" };
  if (!row.isEnabled) return { state: "not_connected" };
  const baseUrl = typeof row.credentials.baseUrl === "string" ? row.credentials.baseUrl.trim() : "";
  const token = typeof row.credentials.token === "string" ? row.credentials.token.trim() : "";
  if (!baseUrl || !token) return { state: "not_connected" };
  try {
    return { state: "live", baseUrl: assertSafeBaseUrl(baseUrl), token };
  } catch (e) {
    if (e instanceof ReferralApiError) return { state: "not_connected" };
    throw e;
  }
}
