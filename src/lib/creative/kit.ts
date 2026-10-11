import { z } from "zod";

import type { BrandProfile } from "./brand";
import { AD_FORMATS, FORMAT_KEYS, charCount, isFormatKey, type FieldValues, type FormatKey } from "./formats";

/**
 * The campaign kit: ONE brief becomes a master hook, a one-line USP and a call to action, plus a variant for each
 * channel format. Validated with zod. The playbook templates here are our own wording of the usual ad-copy craft
 * (curiosity question, step-by-step process, myth and fact, checklist), adapted for India and for a regulated firm: calm
 * and educational, no urgency, no scarcity, no promises, no testimonials, an English or Hinglish voice.
 *
 * Everything is pure and deterministic. The AI path (ai-kit.ts) returns the same shape, so one checker serves both.
 */

export const HOOK_TYPES = ["question", "process", "myth_fact", "checklist"] as const;
export type HookType = (typeof HOOK_TYPES)[number];
export const HOOK_LABEL: Record<HookType, string> = { question: "Curious question", process: "How it works, step by step", myth_fact: "Myth or fact", checklist: "Simple checklist" };

export const briefInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  /** What the ad explains: a process or a concept (for example "opening a demat account"). Never a product pitch. */
  topic: z.string().trim().min(1).max(120),
  audience: z.string().trim().min(1).max(200),
  /** One calm, non-financial next step, for example a short call. Optional. */
  cta: z.string().trim().max(60).optional(),
  usp: z.string().trim().max(140).optional(),
  language: z.enum(["en", "hinglish"]),
  hookType: z.enum(HOOK_TYPES),
  formats: z.array(z.enum(FORMAT_KEYS)).min(1).max(FORMAT_KEYS.length),
});
export type BriefInput = z.infer<typeof briefInputSchema>;

const fieldValuesSchema = z.record(z.string(), z.array(z.string().max(1000)).max(20));
export const variantDraftSchema = z.object({ format: z.enum(FORMAT_KEYS), fields: fieldValuesSchema, disclaimer: z.string().max(900).default("") });
export const masterSchema = z.object({ hook: z.string().trim().min(1).max(160), usp: z.string().trim().min(1).max(200), cta: z.string().trim().min(1).max(80) });
export const kitSchema = z.object({ master: masterSchema, variants: z.array(variantDraftSchema).min(1).max(FORMAT_KEYS.length) });
export type Kit = z.infer<typeof kitSchema>;
export type VariantDraft = z.infer<typeof variantDraftSchema>;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const HOOKS: Record<"en" | "hinglish", Record<HookType, (t: string) => string>> = {
  en: {
    question: (t) => `Not sure how ${t} works?`,
    process: (t) => `${cap(t)}: how it works, step by step`,
    myth_fact: (t) => `Myth or fact: ${t} is complicated?`,
    checklist: (t) => `A simple checklist for ${t}`,
  },
  hinglish: {
    question: (t) => `Kya aap jaante hain ${t} kaise hota hai?`,
    process: (t) => `${cap(t)}: aasan steps mein samjhein`,
    myth_fact: (t) => `Myth ya fact: ${t} mushkil hota hai?`,
    checklist: (t) => `${cap(t)} ke liye ek simple checklist`,
  },
};

const COPY = {
  en: {
    usp: "Plain-language explanations with no jargon and no pressure.",
    cta: "Book a 15-minute call",
    button: "Learn more",
    tiny: ["How it works", "Plain steps", "Learn simply"],
    shortHeads: ["How it works, simply", "Plain-language steps", "Talk to our team", "Learn the basics first", "No jargon, no pressure"],
    shortDesc: ["Understand each step first.", "Plain steps, no pressure.", "Clear answers from our team."],
    descs: (t: string, usp: string, cta: string) => [`Learn how ${t} works, in plain language. ${cta}.`, `Understand every step before you decide. ${usp}`, `${usp} ${cta}.`, `Questions on ${t}? Our team explains calmly, step by step.`],
    generic: (cta: string) => `Learn how it works, in plain language. ${cta}.`,
  },
  hinglish: {
    usp: "Seedhi bhasha mein samjhayenge, bina jargon aur bina pressure ke.",
    cta: "15 minute ki call book karein",
    button: "Jaanein",
    tiny: ["Aasan steps", "Seedhi baat", "Step by step"],
    shortHeads: ["Aasan steps mein samjhein", "Seedhi bhasha, no jargon", "Hamari team se baat karein", "Pehle basics samjhein"],
    shortDesc: ["Har step pehle samjhein.", "Seedhi baat, bina pressure.", "Hamari team samjhayegi."],
    descs: (t: string, usp: string, cta: string) => [`Jaanein ${t} kaise hota hai, seedhi bhasha mein. ${cta}.`, `Faisle se pehle har step samjhein. ${usp}`, `${usp} ${cta}.`, `${cap(t)} par sawaal? Hamari team aaram se samjhayegi.`],
    generic: (cta: string) => `Seedhi bhasha mein samjhein. ${cta}.`,
  },
} as const;

/** The first `n` candidates that fit `max`, without repeats. */
function pick(pool: readonly string[], max: number, n: number): string[] {
  const out: string[] = [];
  for (const c of pool) {
    const v = c.replace(/\s+/g, " ").trim();
    if (v && charCount(v) <= max && !out.includes(v)) out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

function fieldsFor(format: FormatKey, ctx: { hook: string; usp: string; cta: string; topic: string; language: "en" | "hinglish" }): FieldValues {
  const c = COPY[ctx.language];
  const t = ctx.topic;
  const heads = (max: number, n: number) => pick(max <= 15 ? [...c.tiny] : [`${cap(t)} explained`, `New to ${t}?`, ...c.shortHeads], max, n);
  const fillTo = (values: string[], min: number, pool: readonly string[], max: number) => (values.length >= min ? values : [...values, ...pick([...pool].filter((p) => !values.includes(p)), max, min - values.length)]);
  const descPool = [...c.descs(t, ctx.usp, ctx.cta), ...c.shortDesc];
  switch (format) {
    case "google_rsa": {
      const h = fillTo(pick([`${cap(t)} explained`, `New to ${t}?`, ...c.shortHeads], 30, 6), 3, c.tiny, 30);
      return { headline: h, description: fillTo(pick(descPool, 90, 3), 2, c.shortDesc, 90), path: [] };
    }
    case "meta_feed":
      return { primaryText: pick([`${ctx.hook} ${ctx.usp}`, ctx.hook, c.generic(ctx.cta), ...c.shortDesc], 125, 1), headline: heads(40, 1), description: pick(c.shortDesc, 30, 1), cta: [c.button] };
    case "linkedin_single":
      return { introText: pick([`${ctx.hook} ${ctx.usp}`, ctx.hook, c.generic(ctx.cta), ...c.shortDesc], 150, 1), headline: heads(70, 1), cta: [c.button] };
    case "youtube_video":
      return { headline: heads(15, 1), longHeadline: pick([ctx.hook, `${cap(t)} explained`, ...c.shortHeads], 90, 1), description: pick([...descPool], 70, 1), cta: [c.button] };
    case "tiktok_feed":
      return { adText: pick([`${ctx.hook} ${ctx.cta}.`, ctx.hook, c.generic(ctx.cta), ...c.shortDesc], 100, 1), cta: [c.button] };
  }
}

export function disclaimerLine(profile: BrandProfile): string {
  return [profile.disclaimers.risk, profile.disclaimers.registration].filter((s) => s.trim()).join(" ");
}

/** The deterministic kit: no AI, no network. */
export function generateKit(brief: BriefInput, profile: BrandProfile): Kit {
  const language = brief.language;
  const topic = brief.topic.trim().replace(/\s+/g, " ").replace(/^./, (ch) => ch.toLowerCase());
  const hook = HOOKS[language][brief.hookType](topic);
  const usp = brief.usp?.trim() || COPY[language].usp;
  const cta = brief.cta?.trim() || COPY[language].cta;
  const disclaimer = disclaimerLine(profile);
  const wanted = FORMAT_KEYS.filter((k) => brief.formats.includes(k));
  return { master: { hook, usp, cta }, variants: wanted.map((format) => ({ format, fields: fieldsFor(format, { hook, usp, cta, topic, language }), disclaimer })) };
}

export type ParsedKit = { ok: true; kit: Kit } | { ok: false; error: string };

/** Reads a model's reply as a kit: JSON only (a code fence is tolerated), exact shape, known formats. */
export function parseAiKit(reply: string): ParsedKit {
  const trimmed = reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "The reply was not valid JSON." };
  }
  const parsed = kitSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The reply did not have the expected shape." };
  if (parsed.data.variants.some((v) => !isFormatKey(v.format))) return { ok: false, error: "The reply used an unknown format." };
  return { ok: true, kit: parsed.data };
}

export const formatLabel = (k: FormatKey) => AD_FORMATS[k].label;
