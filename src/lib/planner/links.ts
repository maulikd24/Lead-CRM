import { CHANNELS, type ChannelKey } from "./channels";
import { checkDestinationPattern } from "./destinations";
import { buildUtm, campaignSlug, containsPii } from "./naming";

/** Tracked links. Pure. Every link carries the campaign code (`campaign_code`), never a person's details. */

export const CODE_PARAM = "campaign_code";

/** Adds (or replaces) query parameters and leaves the rest of the URL, including a custom app scheme and the fragment, as it was. */
export function appendParams(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export type LinkCheck = { ok: boolean; problems: string[] };

export function validateLink(raw: string): LinkCheck {
  const problems: string[] = [];
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problems: ["Not a valid URL."] };
  }
  if (/^(javascript|data|file|vbscript|blob):/i.test(raw)) problems.push("This link type is not allowed.");
  if (url.protocol === "http:") problems.push("Use https.");
  if (url.username || url.password) problems.push("The link contains a user name or password.");
  const parts = [decodeURIComponent(url.pathname), ...[...url.searchParams.entries()].flatMap(([k, v]) => [k, v])];
  if (parts.some((p) => containsPii(p))) problems.push("The link seems to contain personal data (email, phone number or PAN). Links must carry the campaign code only.");
  return { ok: problems.length === 0, problems };
}

const MESSAGE_MAX = 200;

/** The first WhatsApp message the person sends: the promise in short, and the code so the chat can be matched to the campaign. */
export function defaultWhatsAppMessage(input: { code: string; hook: string }): string {
  const suffix = ` (Ref: ${input.code})`;
  const room = MESSAGE_MAX - suffix.length - 3;
  const hook = input.hook.replace(/\s+/g, " ").trim();
  const lead = hook.length > room ? `${hook.slice(0, room - 1).trimEnd()}…` : hook;
  return `Hi, ${lead}${suffix}`.slice(0, MESSAGE_MAX);
}

export type WhatsAppLink = { ok: true; url: string; message: string } | { ok: false; error: string };

export function buildWhatsAppLink(pattern: string, input: { code: string; hook: string; message?: string }): WhatsAppLink {
  const check = checkDestinationPattern("WHATSAPP_CHAT", pattern);
  if (!check.ok) return { ok: false, error: check.message };
  const message = (input.message?.trim() || defaultWhatsAppMessage(input)).slice(0, MESSAGE_MAX);
  if (!message.includes(input.code)) return { ok: false, error: "The prefilled message must contain the campaign code." };
  if (containsPii(message)) return { ok: false, error: "The prefilled message must not contain personal data." };
  const url = new URL(pattern);
  url.searchParams.set("text", message);
  return { ok: true, url: url.toString(), message };
}

export type TrackedLink = { kind: "tagged" | "whatsapp"; label: string; url: string; validation: LinkCheck; message?: string };
export type TrackedLinksInput = {
  code: string;
  channel: ChannelKey;
  audienceName: string;
  hook: string;
  /** yyyy-mm-dd, used for the quarter in the campaign slug. */
  startDate: string;
  destination: { kind: string; urlPattern: string };
  content?: string;
  term?: string;
};
export type TrackedLinksResult = { ok: true; links: TrackedLink[]; utm: Record<string, string> } | { ok: false; errors: string[] };

export function buildTrackedLinks(input: TrackedLinksInput): TrackedLinksResult {
  const dest = checkDestinationPattern(input.destination.kind, input.destination.urlPattern);
  if (!dest.ok) return { ok: false, errors: [dest.message] };
  const ch = CHANNELS[input.channel];
  const utm = buildUtm({ source: ch.utmSource, medium: ch.utmMedium, campaign: campaignSlug(input.audienceName, input.hook, input.startDate), content: input.content, term: input.term });
  if (!utm.ok) return { ok: false, errors: utm.errors.map((e) => e.message) };
  const params = { ...utm.params, [CODE_PARAM]: input.code } as Record<string, string>;

  if (input.destination.kind === "WHATSAPP_CHAT") {
    const wa = buildWhatsAppLink(input.destination.urlPattern, { code: input.code, hook: input.hook });
    if (!wa.ok) return { ok: false, errors: [wa.error] };
    return { ok: true, utm: params, links: [{ kind: "whatsapp", label: "Click-to-WhatsApp link", url: wa.url, message: wa.message, validation: validateLink(wa.url) }] };
  }
  const url = appendParams(input.destination.urlPattern, params);
  const label = input.destination.kind === "APP_DEEP_LINK" ? "App deep link" : "Tagged landing page link";
  return { ok: true, utm: params, links: [{ kind: "tagged", label, url, validation: validateLink(url) }] };
}
