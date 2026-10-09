import { isContractVerified, REFERRAL_API_PROVIDER } from "./contract";
import { assertSafeBaseUrl, normalisePathPrefix, ReferralApiError } from "./referral-api";

export { REFERRAL_API_PROVIDER };

export type Connection =
  | { state: "mock" }
  | { state: "not_connected" }
  | { state: "live"; baseUrl: string; token: string; pathPrefix: string; contractVerified: boolean };

type Row = { mode: string; isEnabled: boolean; credentials: Record<string, unknown>; settings?: Record<string, unknown> | null };
type Env = { production: boolean; allowSample: boolean };

const fromProcess = (): Env => ({ production: process.env.NODE_ENV === "production", allowSample: process.env.PARTNER_ALLOW_SAMPLE === "1" });

/**
 * Decides how the workspace talks to the referral API from the saved integration row. Pure.
 * Sample data is only ever served outside production, or where PARTNER_ALLOW_SAMPLE=1 says so: in production a
 * missing row or mock mode is "not connected", never fabricated numbers. Live without a usable base URL and token
 * is also "not connected".
 */
export function resolveConnection(row: Row | null, env: Env = fromProcess()): Connection {
  if (!row || row.mode !== "live") return env.production && !env.allowSample ? { state: "not_connected" } : { state: "mock" };
  if (!row.isEnabled) return { state: "not_connected" };
  const baseUrl = typeof row.credentials.baseUrl === "string" ? row.credentials.baseUrl.trim() : "";
  const token = typeof row.credentials.token === "string" ? row.credentials.token.trim() : "";
  if (!baseUrl || !token) return { state: "not_connected" };
  const pathPrefix = normalisePathPrefix(typeof row.credentials.pathPrefix === "string" ? row.credentials.pathPrefix : "");
  try {
    return { state: "live", baseUrl: assertSafeBaseUrl(baseUrl), token, pathPrefix, contractVerified: isContractVerified(row.settings) };
  } catch (e) {
    if (e instanceof ReferralApiError) return { state: "not_connected" };
    throw e;
  }
}
