import { clevertapHost } from "./region";
import { pickIdentity } from "./signals";
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

/** CleverTap expects the country code; a bare 10-digit Indian mobile becomes +91XXXXXXXXXX. Returns null if unusable. */
export function normalizePhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Read-only lookup of one customer's CleverTap profile. Reads are allowed in any region (only writes are India-only).
 * Never logs or returns credentials, request URLs or response bodies.
 */
export async function getAppProfile(client: { email: string | null; mobile: string | null }, deps: AppProfileDeps): Promise<AppProfileResult> {
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

  // Order: exactly what the pusher writes (identity), then email=, then the +91 mobile as identity. Deduped; first record wins.
  const email = client.email?.trim() || null;
  const first = pickIdentity(client);
  const phone = normalizePhone(client.mobile);
  const attempts: string[] = [];
  const add = (q: string) => { if (!attempts.includes(q)) attempts.push(q); };
  if (first) add(`identity=${encodeURIComponent(first)}`);
  if (email) add(`email=${encodeURIComponent(email)}`);
  if (phone && client.mobile?.trim()) add(`identity=${encodeURIComponent(phone)}`);
  if (attempts.length === 0) return { found: false };

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
