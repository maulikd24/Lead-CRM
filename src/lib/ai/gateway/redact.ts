/**
 * The ONE redactor in front of every model call. It extends (and replaces) the three older scrubbers: the nudger's `scrub`, the
 * reply assistant's `scrubForVendor` and the summaries' `redactPii`. With default options the output equals the old scrubbers'
 * (redact.test.ts pins that against verbatim copies), so nothing that already worked changes.
 *
 * What a vendor never needs and never gets, unless the purpose is registered as needing it:
 *   - a PAN, ALWAYS (no purpose may receive one)
 *   - email addresses and runs of 6+ digits (phone, date of birth, account number), unless allowContactIdentifiers
 *   - the subject's name, when the caller supplies it (knownNames), unless allowNames
 *   - link paths and query strings (they carry tokens): a link is cut to its bare host
 */

export type RedactionKind = "pan" | "email" | "number" | "link" | "name";
export type RedactionSummary = Partial<Record<RedactionKind, number>>;
export type RedactOptions = {
  /** The purpose is registered as needing phone numbers and emails (for example a call transcript). A PAN is still removed. */
  allowContactIdentifiers?: boolean;
  /** The purpose is registered as needing the person's name. */
  allowNames?: boolean;
  /** Names to strip (whole words, any case, each part of the name). Used for this call only; never stored. */
  knownNames?: string[];
};

const DEVANAGARI_DIGITS = /[०-९]/g;
const LINK = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?[\/?#]\S*/gi;
const PAN_LOOSE = /\b[A-Z]{5}\s?\d{4}\s?[A-Z]\b/gi;
const DIGIT_RUN = /\+?\d[\d\s().\/-]{4,}\d/g;
const EMAIL = /\S+@\S+/g;
const NUMBER_RUN = /\+?\d[\d\s-]{4,}\d/g;
const LONG_DIGITS = /\d{6,}/g;

const digitCount = (m: string) => m.replace(/\D/g, "").length;
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function tally(summary: RedactionSummary, kind: RedactionKind, n = 1) {
  summary[kind] = (summary[kind] ?? 0) + n;
}

/** Redacts `input`. Returns the safe text and a count per kind (never the removed text). */
export function redact(input: string, opts: RedactOptions = {}): { text: string; summary: RedactionSummary } {
  const summary: RedactionSummary = {};
  const contact = !opts.allowContactIdentifiers;
  let t = input.replace(DEVANAGARI_DIGITS, (d) => String.fromCharCode(d.charCodeAt(0) - 0x966 + 48));
  t = t.replace(PAN_LOOSE, () => (tally(summary, "pan"), "[id]"));
  t = t.replace(LINK, (_m, host: string) => (tally(summary, "link"), host));
  if (contact) {
    t = t.replace(DIGIT_RUN, (m) => (digitCount(m) >= 6 ? (tally(summary, "number"), "[number]") : m));
    t = t.replace(EMAIL, () => (tally(summary, "email"), "[email]"));
  }
  t = t.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, () => (tally(summary, "pan"), "[id]"));
  if (contact) {
    t = t.replace(NUMBER_RUN, (m) => (digitCount(m) >= 6 ? (tally(summary, "number"), "[number]") : m));
    t = t.replace(LONG_DIGITS, () => (tally(summary, "number"), "[number]"));
  }
  if (!opts.allowNames && opts.knownNames?.length) {
    const parts = opts.knownNames.flatMap((n) => [n.trim(), ...n.trim().split(/\s+/)]).filter((p) => p.length >= 2);
    const unique = [...new Set(parts)].sort((a, b) => b.length - a.length);
    for (const p of unique) t = t.replace(new RegExp(`(?<![\\p{L}\\p{M}])${esc(p)}(?![\\p{L}\\p{M}])`, "giu"), () => (tally(summary, "name"), "[name]"));
  }
  return { text: t, summary };
}

/** What `redact` would still find in already-redacted text. The gateway runs this last: a non-empty answer refuses the call. */
export function findSensitive(text: string, opts: RedactOptions = {}): RedactionKind[] {
  const found: RedactionKind[] = [];
  if (/\b[A-Z]{5}\s?\d{4}\s?[A-Z]\b/i.test(text)) found.push("pan");
  if (!opts.allowContactIdentifiers) {
    if (/\S+@\S+/.test(text)) found.push("email");
    for (const m of text.matchAll(DIGIT_RUN)) if (digitCount(m[0]) >= 6) { found.push("number"); break; }
    if (!found.includes("number") && /\d{6,}/.test(text)) found.push("number");
  }
  return found;
}

/** The reply assistant's vendor scrub (kept under its old name): same output as before. */
export function scrubForVendor(input: string): string {
  return redact(input).text;
}

/** The nudger's lighter scrub (kept under its old name): emails, identity numbers and number runs only. */
export function scrub(s: string): string {
  return s
    .replace(EMAIL, "[email]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, "[id]")
    .replace(NUMBER_RUN, (m) => (digitCount(m) >= 6 ? "[number]" : m))
    .replace(LONG_DIGITS, "[number]");
}
