import { describe, expect, it } from "vitest";

import { DEFAULT_BRAND_PROFILE, toRuleSettings } from "./brand";
import { variantText } from "./formats";
import { briefInputSchema, generateKit } from "./kit";
import { checkCopyRules } from "./rules";
import { scoreVariant, VERDICT_THRESHOLDS } from "./rubric";

const brief = briefInputSchema.parse({ title: "t", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: ["meta_feed", "google_rsa"] });
const settings = toRuleSettings(DEFAULT_BRAND_PROFILE);

function score(v: { format: "meta_feed" | "google_rsa"; fields: Record<string, string[]>; disclaimer: string }, language: "en" | "hinglish" = "en") {
  const compliance = checkCopyRules({ text: variantText(v.format, v.fields, v.disclaimer), language, settings });
  return scoreVariant({ ...v, language, topic: brief.topic, compliance });
}

describe("scoreVariant", () => {
  it("scales a clean, clear, single-CTA variant", () => {
    const kit = generateKit(brief, DEFAULT_BRAND_PROFILE);
    for (const v of kit.variants) {
      const r = score(v as never);
      expect(r.verdict).toBe("scale");
      expect(r.score).toBeGreaterThanOrEqual(VERDICT_THRESHOLDS.scale);
      expect(r.overridden).toBe(false);
    }
  });

  it("asks to iterate on a vague but compliant variant", () => {
    const r = score({ format: "meta_feed", fields: { primaryText: ["Some financial thing for people"], headline: ["Our offering"], description: ["Contact"] }, disclaimer: DEFAULT_BRAND_PROFILE.disclaimers.risk });
    expect(r.verdict).not.toBe("scale");
    expect(r.overridden).toBe(false);
  });

  it("a compliance failure overrides any score: the verdict is rewrite and the score is still shown", () => {
    const kit = generateKit(brief, DEFAULT_BRAND_PROFILE);
    const v = JSON.parse(JSON.stringify(kit.variants[0]));
    v.fields.headline = ["Guaranteed returns explained"];
    const r = score(v);
    expect(r.verdict).toBe("rewrite");
    expect(r.overridden).toBe(true);
    expect(r.score).toBeGreaterThan(VERDICT_THRESHOLDS.iterate);
    expect(r.reasons.join(" ")).toMatch(/compliance/i);
  });

  it("jargon lowers the clarity points", () => {
    const clean = score({ format: "meta_feed", fields: { primaryText: ["Learn how an account is opened, step by step. Book a call."], headline: ["Open an account"], description: ["Plain steps"] }, disclaimer: DEFAULT_BRAND_PROFILE.disclaimers.risk });
    const jargon = score({ format: "meta_feed", fields: { primaryText: ["Alpha, NAV and derivatives arbitrage explained. Book a call."], headline: ["Open an account"], description: ["Plain steps"] }, disclaimer: DEFAULT_BRAND_PROFILE.disclaimers.risk });
    const pts = (r: typeof clean) => r.criteria.find((c) => c.id === "clarity")!.points;
    expect(pts(jargon)).toBeLessThan(pts(clean));
  });

  it("two calls to action cost the CTA points", () => {
    const r = score({ format: "meta_feed", fields: { primaryText: ["Book now, call us, talk to us, learn more, start today"], headline: ["Open an account"], description: ["Plain steps"], cta: ["Book, call, talk, start"] }, disclaimer: DEFAULT_BRAND_PROFILE.disclaimers.risk });
    expect(r.criteria.find((c) => c.id === "cta")!.points).toBeLessThan(15);
  });

  it("criteria add up to the score", () => {
    const kit = generateKit(brief, DEFAULT_BRAND_PROFILE);
    const r = score(kit.variants[0] as never);
    expect(r.criteria.reduce((a, c) => a + c.points, 0)).toBe(r.score);
    expect(r.criteria.reduce((a, c) => a + c.max, 0)).toBe(100);
  });
});
