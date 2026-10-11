/**
 * Per-channel ad copy formats: which fields an ad has, how long each may be, and how many of a repeated field.
 * Pure. One table, so a platform change is a one-line edit.
 *
 * The limits are DEFAULTS written from public platform guidance as at late 2026 and shortened where the platform only
 * recommends a length (a longer text is cut behind "see more"). They are a self-check, not the platform's own
 * validator: confirm against the current specifications before booking, and adjust here if a platform changes them.
 */

export const FORMAT_KEYS = ["google_rsa", "meta_feed", "linkedin_single", "youtube_video", "tiktok_feed"] as const;
export type FormatKey = (typeof FORMAT_KEYS)[number];

export type FieldSpec = {
  key: string;
  label: string;
  /** Characters. */
  max: number;
  /** How many values this field takes (a responsive search ad takes 3 to 15 headlines). */
  count: { min: number; max: number };
  hint?: string;
};

export type FormatSpec = { key: FormatKey; label: string; channel: "google" | "meta" | "linkedin" | "youtube" | "tiktok"; fields: FieldSpec[]; note: string };

export const AD_FORMATS: Record<FormatKey, FormatSpec> = {
  google_rsa: {
    key: "google_rsa",
    label: "Google responsive search ad",
    channel: "google",
    note: "Google mixes your headlines and descriptions, so every one must read well on its own.",
    fields: [
      { key: "headline", label: "Headline", max: 30, count: { min: 3, max: 15 }, hint: "3 to 15 headlines" },
      { key: "description", label: "Description", max: 90, count: { min: 2, max: 4 }, hint: "2 to 4 descriptions" },
      { key: "path", label: "Display path", max: 15, count: { min: 0, max: 2 }, hint: "Optional, up to 2" },
    ],
  },
  meta_feed: {
    key: "meta_feed",
    label: "Meta feed ad (Facebook and Instagram)",
    channel: "meta",
    note: "Primary text is cut behind \"see more\" after about 125 characters.",
    fields: [
      { key: "primaryText", label: "Primary text", max: 125, count: { min: 1, max: 1 } },
      { key: "headline", label: "Headline", max: 40, count: { min: 1, max: 1 } },
      { key: "description", label: "Description", max: 30, count: { min: 1, max: 1 } },
      { key: "cta", label: "Button text", max: 25, count: { min: 0, max: 1 }, hint: "Optional" },
    ],
  },
  linkedin_single: {
    key: "linkedin_single",
    label: "LinkedIn single image ad",
    channel: "linkedin",
    note: "Intro text is cut behind \"see more\" after about 150 characters.",
    fields: [
      { key: "introText", label: "Intro text", max: 150, count: { min: 1, max: 1 } },
      { key: "headline", label: "Headline", max: 70, count: { min: 1, max: 1 } },
      { key: "cta", label: "Button text", max: 25, count: { min: 0, max: 1 }, hint: "Optional" },
    ],
  },
  youtube_video: {
    key: "youtube_video",
    label: "YouTube video ad",
    channel: "youtube",
    note: "The video itself carries the message: this is the text around it.",
    fields: [
      { key: "headline", label: "Headline", max: 15, count: { min: 1, max: 1 } },
      { key: "longHeadline", label: "Long headline", max: 90, count: { min: 1, max: 1 } },
      { key: "description", label: "Description", max: 70, count: { min: 1, max: 1 } },
      { key: "cta", label: "Button text", max: 10, count: { min: 0, max: 1 }, hint: "Optional" },
    ],
  },
  tiktok_feed: {
    key: "tiktok_feed",
    label: "TikTok in-feed ad",
    channel: "tiktok",
    note: "Keep it short: ad text is limited to 100 characters.",
    fields: [
      { key: "adText", label: "Ad text", max: 100, count: { min: 1, max: 1 } },
      { key: "cta", label: "Button text", max: 20, count: { min: 0, max: 1 }, hint: "Optional" },
    ],
  },
};

export const isFormatKey = (v: unknown): v is FormatKey => typeof v === "string" && (FORMAT_KEYS as readonly string[]).includes(v);

export type FieldValues = Record<string, string[]>;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
/** Characters as a person counts them: an emoji or a Devanagari conjunct is one. */
export function charCount(text: string): number {
  if (!segmenter) return Array.from(text).length;
  let n = 0;
  for (const _ of segmenter.segment(text)) n++; // eslint-disable-line @typescript-eslint/no-unused-vars
  return n;
}

export type LimitIssue = { kind: "length" | "count" | "empty"; field: string; index?: number; length?: number; max?: number; message: string };

export function checkFieldLimits(format: FormatKey, fields: FieldValues): { ok: boolean; issues: LimitIssue[] } {
  const issues: LimitIssue[] = [];
  for (const spec of AD_FORMATS[format].fields) {
    const values = fields[spec.key] ?? [];
    const filled = values.filter((v) => v.trim() !== "");
    if (spec.count.min > 0 && filled.length === 0 && values.length >= 1 && spec.count.max === 1) issues.push({ kind: "empty", field: spec.key, message: `${spec.label} is empty.` });
    else if (filled.length < spec.count.min) issues.push({ kind: "count", field: spec.key, message: `${spec.label}: add at least ${spec.count.min} (you have ${filled.length}).` });
    if (values.length > spec.count.max) issues.push({ kind: "count", field: spec.key, message: `${spec.label}: at most ${spec.count.max} allowed (you have ${values.length}).` });
    values.forEach((v, index) => {
      const length = charCount(v);
      if (length > spec.max) issues.push({ kind: "length", field: spec.key, index, length, max: spec.max, message: `${spec.label} ${values.length > 1 ? index + 1 : ""} is ${length} characters; the limit is ${spec.max}.`.replace("  ", " ") });
    });
  }
  return { ok: issues.length === 0, issues };
}

export function counterState(length: number, max: number): "ok" | "near" | "over" {
  if (length > max) return "over";
  return length >= max * 0.85 ? "near" : "ok";
}

/** Every piece of the copy, plus the disclaimer, as one text, so the rules see all of what a reader would see. */
export function variantText(format: FormatKey, fields: FieldValues, disclaimer: string): string {
  const parts: string[] = [];
  for (const spec of AD_FORMATS[format].fields) for (const v of fields[spec.key] ?? []) if (v.trim()) parts.push(v.trim());
  if (disclaimer.trim()) parts.push(disclaimer.trim());
  return parts.join("\n");
}
