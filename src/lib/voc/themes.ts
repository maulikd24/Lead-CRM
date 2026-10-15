/**
 * The closed theme list the model may choose from, and the parser for its reply. A reply that is empty, not JSON, or names no
 * known theme is an explicit abstain, never a guessed theme.
 */

export const VOC_THEMES = [
  "delay",
  "fees",
  "service_quality",
  "communication",
  "product_information",
  "onboarding",
  "reports_statements",
  "technology",
  "other",
] as const;
export type VocTheme = (typeof VOC_THEMES)[number];

export const MAX_THEMES_PER_ITEM = 3;

const KNOWN = new Set<string>(VOC_THEMES);

export type TagParse =
  | { ok: true; themes: VocTheme[] }
  | { ok: false; reason: "empty" | "malformed" | "model_abstained" };

/** Reads a model reply of the form {"themes":["delay","fees"]}. Unknown theme names are dropped; if none remain the reply is malformed. */
export function parseTagReply(text: string): TagParse {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (/^ABSTAIN\b/i.test(trimmed)) return { ok: false, reason: "model_abstained" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "malformed" };
  const raw = (parsed as { themes?: unknown }).themes;
  if (!Array.isArray(raw)) return { ok: false, reason: "malformed" };
  const themes: VocTheme[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !KNOWN.has(v)) continue;
    if (!themes.includes(v as VocTheme)) themes.push(v as VocTheme);
    if (themes.length === MAX_THEMES_PER_ITEM) break;
  }
  if (themes.length === 0) return { ok: false, reason: "malformed" };
  return { ok: true, themes };
}
