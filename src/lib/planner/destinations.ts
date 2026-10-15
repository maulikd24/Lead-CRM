/** Destinations: where a campaign lands. Pure URL-pattern health check; the tools behind them are built elsewhere. */
export const DESTINATION_KINDS = ["APP_DEEP_LINK", "WEB_LANDING", "WHATSAPP_CHAT"] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];
export const DESTINATION_STATUSES = ["LIVE", "PLANNED", "OFF"] as const;
export type DestinationStatus = (typeof DESTINATION_STATUSES)[number];

export const KIND_LABEL: Record<DestinationKind, string> = { APP_DEEP_LINK: "App screen", WEB_LANDING: "Landing page", WHATSAPP_CHAT: "WhatsApp chat" };
export const STATUS_LABEL: Record<DestinationStatus, string> = { LIVE: "Live", PLANNED: "Planned", OFF: "Off" };

export const isDestinationKind = (v: unknown): v is DestinationKind => typeof v === "string" && (DESTINATION_KINDS as readonly string[]).includes(v);
export const isDestinationStatus = (v: unknown): v is DestinationStatus => typeof v === "string" && (DESTINATION_STATUSES as readonly string[]).includes(v);
/** A planned or switched-off destination can be attached to a plan but is flagged. */
export const isNotLiveYet = (status: string): boolean => status !== "LIVE";

export type PatternCheck = { ok: boolean; message: string };
const fail = (message: string): PatternCheck => ({ ok: false, message });
const ok = (message = "The URL pattern is valid."): PatternCheck => ({ ok: true, message });

const parse = (raw: string): URL | null => {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
};
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function checkDestinationPattern(kind: string, pattern: string): PatternCheck {
  const raw = (pattern ?? "").trim();
  if (!raw) return fail("Enter a URL.");
  if (/[\s{}<>"]/.test(raw)) return fail("The URL has spaces or characters that do not belong in a link.");
  const url = parse(raw);
  if (!url) return fail("This is not a valid URL.");
  if (url.username || url.password) return fail("The URL must not contain a user name or password.");

  switch (kind) {
    case "WEB_LANDING":
      if (url.protocol !== "https:") return fail("A landing page must use https.");
      if (!HOST.test(url.hostname)) return fail("The address needs a real host name.");
      return ok();
    case "APP_DEEP_LINK": {
      if (/^(javascript|data|file|vbscript|blob):/i.test(raw)) return fail("That link type is not allowed.");
      if (url.protocol === "https:") return HOST.test(url.hostname) ? ok() : fail("The address needs a real host name.");
      if (url.protocol === "http:") return fail("Use a custom app scheme or an https universal link.");
      if (!/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i.test(raw)) return fail("An app link looks like scheme://screen/path.");
      return ok();
    }
    case "WHATSAPP_CHAT": {
      if (url.protocol !== "https:") return fail("A WhatsApp link must use https.");
      if (url.hostname === "wa.me") return /^\/\d{8,15}$/.test(url.pathname) ? ok() : fail("wa.me must be followed by the number in international format, digits only.");
      if (url.hostname === "api.whatsapp.com" && url.pathname === "/send") return /^\d{8,15}$/.test(url.searchParams.get("phone") ?? "") ? ok() : fail("api.whatsapp.com/send needs phone= with the number in international format.");
      return fail("Use a wa.me or api.whatsapp.com link.");
    }
    default:
      return fail("Unknown destination kind.");
  }
}
