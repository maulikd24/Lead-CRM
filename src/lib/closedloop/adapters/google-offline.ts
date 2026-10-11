import type { EventType } from "../events";
import type { ConversionDestination, EventResult, OutboundEvent } from "../types";
import type { FetchLike } from "./meta-capi";

export type GoogleOfflineConfig = {
  customerId: string;
  loginCustomerId?: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Conversion action id per event type, created in the Google Ads account by the advertiser. */
  conversionActions: Partial<Record<EventType, string>>;
  apiVersion?: string;
};

const DEFAULT_VERSION = "v22";
const digits = (v: string) => v.replace(/\D/g, "");
const RATE_WAIT_MS = 3_600_000;
/** Error families that are worth another try. */
const TRANSIENT = new Set(["internalError", "quotaError", "databaseError"]);

/** "2027-03-19 10:30:00+00:00", the format Google documents for conversionDateTime. */
function dateTime(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace("T", " ")}+00:00`;
}

/**
 * Google Ads offline conversions, written against the documented request: POST
 * /{version}/customers/{id}:uploadClickConversions with { conversions: [...], partialFailure: true }. Each conversion has
 * conversionAction (resource name), conversionDateTime, orderId (our dedup id: Google ignores a repeated order id for the
 * same action), the gclid when the lead had one, userIdentifiers (hashedEmail, hashedPhoneNumber) for enhanced matching,
 * conversionValue and currencyCode when a value is sent, and a consent block (only consented customers ever get here).
 * Auth is an OAuth refresh-token exchange plus the developer-token header; all four secrets come from Settings (entered by
 * an Admin) and are never placed in a result or a log. Responses are reduced to short codes: no message text is kept,
 * because an error message can echo a submitted identifier.
 */
export function createGoogleOfflineDestination(opts: { config: GoogleOfflineConfig; fetch: FetchLike }): ConversionDestination {
  const { config } = opts;
  const customer = digits(config.customerId);
  const uploadUrl = `https://googleads.googleapis.com/${config.apiVersion || DEFAULT_VERSION}/customers/${customer}:uploadClickConversions`;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string | null> {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const form = new URLSearchParams({ grant_type: "refresh_token", client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken });
    const res = await opts.fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
    if (res.status !== 200) return null;
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return token.value;
  }

  const toConversion = (e: OutboundEvent, action: string) => {
    const c: Record<string, unknown> = {
      conversionAction: `customers/${customer}/conversionActions/${digits(action)}`,
      conversionDateTime: dateTime(e.occurredAt),
      orderId: e.dedupId,
    };
    if (e.identity.gclid) c.gclid = e.identity.gclid;
    const ids: Record<string, string>[] = [];
    if (e.identity.hashedEmail) ids.push({ hashedEmail: e.identity.hashedEmail });
    if (e.identity.hashedPhone) ids.push({ hashedPhoneNumber: e.identity.hashedPhone });
    if (ids.length) c.userIdentifiers = ids;
    if (e.value != null) Object.assign(c, { conversionValue: e.value, currencyCode: "INR" });
    c.consent = { adUserData: "GRANTED", adPersonalization: "GRANTED" };
    return c;
  };

  return {
    key: "google_ads",
    platform: "google",
    maxBatch: 200,
    maxEventAgeDays: 90,
    async send(events) {
      const results = new Map<string, EventResult>();
      const sendable: { e: OutboundEvent; action: string }[] = [];
      for (const e of events) {
        const action = config.conversionActions[e.eventType];
        if (action && digits(action)) sendable.push({ e, action });
        else results.set(e.dedupId, { dedupId: e.dedupId, outcome: "rejected", errorCode: "no_conversion_action" });
      }
      const retryAll = (errorCode: string, retryAfterMs?: number) => {
        for (const { e } of sendable) results.set(e.dedupId, { dedupId: e.dedupId, outcome: "retry", errorCode, ...(retryAfterMs ? { retryAfterMs } : {}) });
      };
      if (sendable.length > 0) {
        const t = await accessToken();
        if (!t) retryAll("auth_error");
        else {
          const headers: Record<string, string> = { authorization: `Bearer ${t}`, "developer-token": config.developerToken, "content-type": "application/json" };
          if (config.loginCustomerId && digits(config.loginCustomerId)) headers["login-customer-id"] = digits(config.loginCustomerId);
          const res = await opts.fetch(uploadUrl, { method: "POST", headers, body: JSON.stringify({ conversions: sendable.map((s) => toConversion(s.e, s.action)), partialFailure: true }) });
          if (res.status === 200) {
            const json = (await res.json().catch(() => ({}))) as { partialFailureError?: { details?: { errors?: { errorCode?: Record<string, string>; location?: { fieldPathElements?: { index?: number }[] } }[] }[] } };
            const failed = new Map<number, "retry" | "rejected">();
            for (const detail of json.partialFailureError?.details ?? []) {
              for (const err of detail.errors ?? []) {
                const index = err.location?.fieldPathElements?.find((p) => typeof p.index === "number")?.index;
                if (index === undefined) continue;
                const family = Object.keys(err.errorCode ?? {})[0] ?? "";
                failed.set(index, TRANSIENT.has(family) ? "retry" : "rejected");
              }
            }
            sendable.forEach(({ e }, i) => {
              const f = failed.get(i);
              results.set(e.dedupId, f === "retry" ? { dedupId: e.dedupId, outcome: "retry", errorCode: "transient_error" } : f === "rejected" ? { dedupId: e.dedupId, outcome: "rejected", errorCode: "upload_rejected" } : { dedupId: e.dedupId, outcome: "sent" });
            });
          } else if (res.status === 429) retryAll("rate_limited", RATE_WAIT_MS);
          else if (res.status === 401 || res.status === 403) retryAll("auth_error");
          else if (res.status >= 500) retryAll(`http_${res.status}`);
          else for (const { e } of sendable) results.set(e.dedupId, { dedupId: e.dedupId, outcome: "rejected", errorCode: "invalid_request" });
        }
      }
      return events.map((e) => results.get(e.dedupId)!);
    },
  };
}
