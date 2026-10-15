import type { ConversionDestination, EventResult, OutboundEvent } from "../types";

/** The slice of fetch the adapters use, so tests inject a fake and nothing here ever needs a real network. */
export type FetchLike = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>;

export type MetaCapiConfig = { pixelId: string; accessToken: string; apiVersion?: string; testEventCode?: string };

const EVENT_NAME = { KYC_COMPLETE: "KycComplete", FIRST_FUNDING: "FirstFunding", AUM_BAND: "AumBandReached" } as const;
const DEFAULT_VERSION = "v21.0";
const RATE_LIMIT_WAIT_MS = 3_600_000;
/** Meta error codes that mean "slow down". */
const RATE_CODES = new Set([4, 17, 32, 613]);

/**
 * Meta Conversions API, written against the documented request: POST /{version}/{pixel_id}/events with
 * { data: [event...], access_token, test_event_code? }. Each event: event_name, event_time (unix seconds), event_id (our
 * dedup id: Meta drops a repeat of the same id and name), action_source "system_generated" (a CRM-side event),
 * user_data { em, ph (hashed, arrays), fbc, fbp (as they are) } and custom_data.
 *
 * Not wired to credentials: the pixel id and token are entered by an Admin in Settings and passed in by the caller. The
 * token is only ever put in the request body, never in the URL or in any result or log. Responses are read for a status and
 * a short code only.
 */
export function createMetaCapiDestination(opts: { config: MetaCapiConfig; fetch: FetchLike }): ConversionDestination {
  const { config } = opts;
  const url = `https://graph.facebook.com/${config.apiVersion || DEFAULT_VERSION}/${encodeURIComponent(config.pixelId)}/events`;

  const toEvent = (e: OutboundEvent) => {
    const user: Record<string, unknown> = {};
    if (e.identity.hashedEmail) user.em = [e.identity.hashedEmail];
    if (e.identity.hashedPhone) user.ph = [e.identity.hashedPhone];
    if (e.identity.fbc) user.fbc = e.identity.fbc;
    if (e.identity.fbp) user.fbp = e.identity.fbp;
    const out: Record<string, unknown> = {
      event_name: EVENT_NAME[e.eventType],
      event_time: Math.floor(e.occurredAt.getTime() / 1000),
      event_id: e.dedupId,
      action_source: "system_generated",
      user_data: user,
    };
    const custom: Record<string, unknown> = {};
    if (e.value != null) Object.assign(custom, { value: e.value, currency: "INR" });
    if (e.eventType === "AUM_BAND" && e.qualifier) custom.aum_band = e.qualifier;
    if (Object.keys(custom).length) out.custom_data = custom;
    return out;
  };

  const all = (events: OutboundEvent[], r: Omit<EventResult, "dedupId">): EventResult[] => events.map((e) => ({ dedupId: e.dedupId, ...r }));

  return {
    key: "meta_capi",
    platform: "meta",
    maxBatch: 1000,
    maxEventAgeDays: 7,
    async send(events) {
      const body: Record<string, unknown> = { data: events.map(toEvent), access_token: config.accessToken };
      if (config.testEventCode) body.test_event_code = config.testEventCode;
      const res = await opts.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 200) {
        const json = (await res.json().catch(() => ({}))) as { events_received?: number };
        return typeof json.events_received === "number" && json.events_received < events.length ? all(events, { outcome: "retry", errorCode: "partial_receipt" }) : all(events, { outcome: "sent" });
      }
      const json = (await res.json().catch(() => ({}))) as { error?: { code?: number } };
      const code = json.error?.code;
      if (res.status === 429 || (code !== undefined && RATE_CODES.has(code))) return all(events, { outcome: "retry", errorCode: "rate_limited", retryAfterMs: RATE_LIMIT_WAIT_MS });
      if (res.status === 401 || res.status === 403 || code === 190) return all(events, { outcome: "retry", errorCode: "auth_error" });
      if (res.status >= 500) return all(events, { outcome: "retry", errorCode: `http_${res.status}` });
      return all(events, { outcome: "rejected", errorCode: "invalid_parameter" });
    },
  };
}
