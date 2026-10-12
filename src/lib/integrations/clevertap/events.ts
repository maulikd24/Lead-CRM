import type { NormalizedEvent } from "@/lib/integrations/types";

const MAX_NAME_CHARS = 120;
const MAX_KEY_CHARS = 60;
const MAX_PROP_CHARS = 300;
const MAX_PROPS = 15;
const MAX_PROPS_JSON_CHARS = 1_500;
const MAX_EMAIL_CHARS = 254;
const PHONE_RE = /^\+?[\d\s().-]+$/;
const PAN_RE = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const LONG_DIGITS_RE = /\d{9,}/g;
// Only these keys (lowercased, separators removed) are ever stored; everything else may hold PII.
const SAFE_KEYS = new Set(["campaign", "campaignname", "campaignid", "channel", "platform", "source", "step", "status", "screen", "product", "category"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/g;

/** Control characters (newlines, tabs, escapes) become a single space, then the text is trimmed and capped. */
function clean(text: string, max: number): string {
  return text.replace(CONTROL_RE, " ").trim().slice(0, max).trim();
}

export function labelFor(evtName: string): string {
  const text = evtName.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text !== text.toLowerCase()) return text;
  const acronymed = text.replace(/\bkyc\b/g, "KYC");
  return acronymed.charAt(0).toUpperCase() + acronymed.slice(1);
}

const scrub = (v: string): string => v.replace(PAN_RE, "[redacted]").replace(LONG_DIGITS_RE, "[redacted]");
const shortNumber = (n: number): boolean => Number.isFinite(n) && Math.abs(n) < 1e9 && String(Math.abs(n)).replace(/\D/g, "").length < 9;

/** Allowlisted keys only, scrubbed values; each string capped, then whole props dropped from the end until the JSON fits. */
function pickProps(data: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [rawKey, v] of Object.entries(data)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    const k = clean(rawKey, MAX_KEY_CHARS);
    if (!SAFE_KEYS.has(k.toLowerCase().replace(/[\s_.-]+/g, ""))) continue;
    if (typeof v === "string") out[k] = clean(scrub(clean(v, 10_000)), MAX_PROP_CHARS);
    else if (typeof v === "number" && shortNumber(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  const keys = Object.keys(out);
  while (keys.length && JSON.stringify(out).length > MAX_PROPS_JSON_CHARS) delete out[keys.pop() as string];
  return out;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const asEmail = (v: unknown): string | undefined => {
  const s = str(v);
  // The route matches email by exact equality and the repo stores it lowercase.
  return s && s.length <= MAX_EMAIL_CHARS && EMAIL_RE.test(s) ? s.toLowerCase() : undefined;
};
const asPhone = (v: unknown): string | undefined => {
  const s = str(v);
  if (!s || s.length > 30 || !PHONE_RE.test(s)) return undefined;
  const digits = s.replace(/\D/g, "").length;
  return digits >= 10 && digits <= 15 ? s : undefined;
};

/**
 * CleverTap webhook body ({ identity, evtName, evtData }) to the route's NormalizedEvent. Always a
 * "campaign_event", which the webhook route logs as a MESSAGE activity on an existing client. The timeline
 * renders `payload.message`, so that is the human line; `eventName` and capped `props` are kept for detail.
 *
 * Event with no usable email or phone: returns [] on purpose. The route can only match a client by email or
 * phone and silently skips anything else (CleverTap never creates leads), so emitting it would only inflate
 * eventsProcessed. The raw identity is never stored: when it is an opaque id it is PII-adjacent and useless.
 */
export function normalizeCleverTapEvent(payload: unknown): NormalizedEvent[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const body = payload as { identity?: unknown; evtName?: unknown; evtData?: unknown };
  const rawName = str(body.evtName);
  const evtName = rawName ? clean(rawName, MAX_NAME_CHARS) : "";
  if (!evtName) return [];
  const data = body.evtData && typeof body.evtData === "object" && !Array.isArray(body.evtData) ? (body.evtData as Record<string, unknown>) : {};

  // The identity can be the profile's email or phone; app users are often keyed on an opaque id (for example
  // the Keycloak subject), so fall back to profile fields carried on the event. Phones pass through as sent:
  // the route normalises them (last 10 digits).
  const identity = str(body.identity);
  const clientEmail = asEmail(identity) ?? asEmail(data.Email) ?? asEmail(data.email);
  const clientPhone = asPhone(identity) ?? asPhone(data.Phone) ?? asPhone(data.phone) ?? asPhone(data.mobile);
  if (!clientEmail && !clientPhone) return [];
  // A name like "___" humanises to nothing: show the stripped name instead of a bare "App event: ".
  const label = labelFor(evtName) || evtName;

  return [{
    type: "campaign_event",
    clientEmail,
    clientPhone,
    payload: { eventName: evtName, message: `App event: ${label}`, props: pickProps(data) },
  }];
}
