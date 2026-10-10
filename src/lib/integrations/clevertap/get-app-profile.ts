import { clevertapHost } from "./region";
import { parseProfile, type AppProfile } from "./profile";

export type AppProfileConfig = { mode: string; isEnabled: boolean; credentials: Record<string, unknown> | null } | null;
export type AppProfileDeps = {
  loadConfig: () => Promise<AppProfileConfig>;
  fetch: typeof fetch;
};
export type AppProfileErrorKind = "not_connected" | "rejected" | "busy" | "unreachable";
export type AppProfileResult = AppProfile | { found: false } | { error: string; kind: AppProfileErrorKind };

const NOT_CONNECTED = { error: "CleverTap is not connected", kind: "not_connected" } as const;
const TOTAL_BUDGET_MS = 6000;

/**
 * Read-only lookup of one customer's CleverTap profile, keyed on the app user id. Reads are allowed in any region (only writes are India-only).
 * Never logs or returns credentials, request URLs or response bodies.
 */
export async function getAppProfile(client: { appUserId: string | null }, deps: AppProfileDeps): Promise<AppProfileResult> {
  let config: AppProfileConfig;
  try {
    config = await deps.loadConfig();
  } catch {
    return { ...NOT_CONNECTED };
  }
  if (!config || !config.isEnabled || config.mode !== "live" || !config.credentials) return { ...NOT_CONNECTED };
  const accountId = String(config.credentials.accountId ?? "");
  const passcode = String(config.credentials.passcode ?? "");
  if (!accountId || !passcode) return { ...NOT_CONNECTED };
  let host: string;
  try {
    host = clevertapHost(config.credentials.region ? String(config.credentials.region) : "");
  } catch {
    return { ...NOT_CONNECTED };
  }

  // The CleverTap Identity is the app user id, so that is the only key used. A customer without one is not an app user: no request.
  const appUserId = client.appUserId?.trim();
  if (!appUserId) return { found: false };
  const attempts = [`identity=${encodeURIComponent(appUserId)}`];

  // One shared budget so a slow CleverTap can never stall the page for more than ~6s in total.
  const signal = AbortSignal.timeout(TOTAL_BUDGET_MS);
  for (const query of attempts) {
    try {
      const res = await deps.fetch(`https://${host}/1/profile.json?${query}`, {
        method: "GET",
        headers: { "X-CleverTap-Account-Id": accountId, "X-CleverTap-Passcode": passcode },
        signal,
      });
      if (!res.ok) return { error: `CleverTap responded ${res.status}`, kind: res.status === 429 ? "busy" : res.status >= 400 && res.status < 500 ? "rejected" : "unreachable" };
      const parsed = parseProfile(await res.json());
      if (parsed) return parsed;
    } catch {
      return { error: "CleverTap is unreachable", kind: "unreachable" };
    }
  }
  return { found: false };
}
