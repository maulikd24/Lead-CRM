/** Campaign codes and the UTM naming convention. Pure. */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1: easy to read out over a call
const CODE_RE = /^CP-[A-HJ-NP-Z2-9]{6}$/;

export function newCampaignCode(random: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.floor(random() * CODE_ALPHABET.length))];
  return `CP-${s}`;
}
export const isCampaignCode = (v: unknown): v is string => typeof v === "string" && CODE_RE.test(v);

/** The convention: lowercase letters, digits, underscore, hyphen; 1 to 40 characters. */
const UTM_RE = /^[a-z0-9_-]{1,40}$/;
export const isValidUtmValue = (v: string): boolean => UTM_RE.test(v);

/** Anything that looks like an email, a phone number, a PAN or a long digit run. Such values never go into a URL. */
export function containsPii(v: string): boolean {
  const t = v.trim();
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(t)) return true;
  if (/\b[A-Z]{5}\d{4}[A-Z]\b/i.test(t)) return true;
  return /\d{8,}/.test(t.replace(/[\s()+-]/g, ""));
}

export type UtmParts = { source: string; medium: string; campaign: string; content?: string; term?: string };
export type UtmParams = Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term", string>>;
export type UtmResult = { ok: true; params: UtmParams } | { ok: false; errors: { field: keyof UtmParts; message: string }[] };

const REQUIRED: (keyof UtmParts)[] = ["source", "medium", "campaign"];
const OPTIONAL: (keyof UtmParts)[] = ["content", "term"];

export function buildUtm(parts: UtmParts): UtmResult {
  const errors: { field: keyof UtmParts; message: string }[] = [];
  for (const field of REQUIRED) {
    const v = parts[field] ?? "";
    if (!v) errors.push({ field, message: `${field} is required.` });
    else if (containsPii(v)) errors.push({ field, message: `${field} looks like personal data and cannot go in a link.` });
    else if (!isValidUtmValue(v)) errors.push({ field, message: `${field} must be lowercase letters, digits, underscore or hyphen, up to 40 characters.` });
  }
  for (const field of OPTIONAL) {
    const v = parts[field];
    if (!v) continue;
    if (containsPii(v)) errors.push({ field, message: `${field} looks like personal data and cannot go in a link.` });
    else if (!isValidUtmValue(v)) errors.push({ field, message: `${field} must be lowercase letters, digits, underscore or hyphen, up to 40 characters.` });
  }
  if (errors.length) return { ok: false, errors };
  const params: UtmParams = { utm_source: parts.source, utm_medium: parts.medium, utm_campaign: parts.campaign };
  if (parts.content) params.utm_content = parts.content;
  if (parts.term) params.utm_term = parts.term;
  return { ok: true, params };
}

const STOP = new Set(["a", "an", "the", "of", "to", "in", "for", "and", "or", "your", "you", "are", "is", "on", "as", "what"]);
const words = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);

/** audience, the first words of the promise, and the quarter: "salaried_see_if_you_are_on_track_2026q4". Always convention-safe. */
export function campaignSlug(audienceName: string, hook: string, startDate: string): string {
  const d = /^(\d{4})-(\d{2})/.exec(startDate);
  const quarter = d ? `${d[1]}q${Math.floor((Number(d[2]) - 1) / 3) + 1}` : "undated";
  const audience = words(audienceName).filter((w) => !STOP.has(w))[0] ?? "audience";
  const hookWords = words(hook).slice(0, 6).filter((w) => w !== audience);
  let slug = [audience, ...hookWords].join("_");
  const tail = `_${quarter}`;
  if (slug.length + tail.length > 40) slug = slug.slice(0, 40 - tail.length).replace(/_+$/, "");
  return `${slug}${tail}`;
}
