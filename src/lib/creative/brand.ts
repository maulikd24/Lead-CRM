import { z } from "zod";

import { DEFAULT_DISCLAIMER, DEFAULT_PAST_PERFORMANCE, type RuleSettings } from "./rules";

/**
 * The brand profile: tone, audiences, regulated claims and mandatory disclaimers, as structured context for every
 * brief. Versioned (a change is a new version; old versions stay so an approved ad can show which rules it was
 * checked against). Pure.
 */

export const brandProfileSchema = z.object({
  tone: z.object({
    voice: z.string().trim().min(3).max(400),
    dos: z.array(z.string().trim().min(1).max(200)).max(12),
    donts: z.array(z.string().trim().min(1).max(200)).max(12),
  }),
  audiences: z.array(z.object({ key: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(80), description: z.string().trim().max(300), language: z.enum(["en", "hinglish"]) })).min(1).max(12),
  /** Claims that may only run with the full disclaimer beside them. */
  regulatedClaims: z.array(z.string().trim().min(1).max(120)).max(50),
  bannedWords: z.array(z.string().trim().min(1).max(60)).max(100),
  testimonialsProhibited: z.boolean(),
  disclaimers: z.object({
    risk: z.string().trim().min(20).max(600),
    pastPerformance: z.string().trim().min(10).max(300),
    /** The registration line is supplied by the firm; empty means "not set" and shows as a gap on screen. */
    registration: z.string().trim().max(300),
    /** One plain-language sentence about risk, added after the mandatory disclosure so a reader sees it in everyday words. */
    plainRisk: z.object({ en: z.string().trim().max(300), hinglish: z.string().trim().max(300) }).default({ en: "Markets go up and down, and you may lose some or all of the money you invest.", hinglish: "Market upar-neeche hota rehta hai, aur aapko lagaye hue paise ka kuch hissa ya poora nuksan ho sakta hai." }),
  }),
});

export type BrandProfile = z.infer<typeof brandProfileSchema>;

export const DEFAULT_BRAND_PROFILE: BrandProfile = {
  tone: {
    voice: "Calm, clear and respectful. Explains how things work in plain words and never pressures.",
    dos: ["Use short sentences", "Explain a term the first time you use it", "Offer one calm next step"],
    donts: ["No hype or urgency", "No promises about returns", "No jargon without a plain explanation"],
  },
  audiences: [
    { key: "first_time", label: "First-time investors", description: "New to markets; wants to understand the process before committing.", language: "en" },
    { key: "hinglish_urban", label: "Hinglish-speaking professionals", description: "Comfortable in English and Hindi; prefers casual, direct wording.", language: "hinglish" },
  ],
  regulatedClaims: [],
  bannedWords: ["multibagger", "jackpot", "hot tip", "stock tips"],
  testimonialsProhibited: true,
  disclaimers: { risk: DEFAULT_DISCLAIMER, pastPerformance: DEFAULT_PAST_PERFORMANCE, registration: "", plainRisk: { en: "Markets go up and down, and you may lose some or all of the money you invest.", hinglish: "Market upar-neeche hota rehta hai, aur aapko lagaye hue paise ka kuch hissa ya poora nuksan ho sakta hai." } },
};

export function toRuleSettings(p: BrandProfile): RuleSettings {
  return { disclaimer: p.disclaimers.risk, pastPerformanceDisclaimer: p.disclaimers.pastPerformance, testimonialsProhibited: p.testimonialsProhibited, bannedWords: p.bannedWords, regulatedClaims: p.regulatedClaims };
}

export const nextProfileVersion = (existing: number[]): number => (existing.length ? Math.max(...existing) : 0) + 1;

/** The short context sent with a drafting request: tone and audiences only. */
export function toPromptContext(p: BrandProfile): string {
  return [`Voice: ${p.tone.voice}`, `Do: ${p.tone.dos.join("; ")}`, `Do not: ${p.tone.donts.join("; ")}`, `Audiences: ${p.audiences.map((a) => `${a.label} (${a.description})`).join(" | ")}`].join("\n");
}
