import { describe, expect, it } from "vitest";

import { AD_FORMATS, FORMAT_KEYS, checkFieldLimits, variantText } from "./formats";
import { DEFAULT_BRAND_PROFILE, toRuleSettings } from "./brand";
import { HOOK_TYPES, briefInputSchema, generateKit, kitSchema, parseAiKit } from "./kit";
import { checkCopyRules } from "./rules";

const brief = (over: Record<string, unknown> = {}) => briefInputSchema.parse({ title: "Demat basics", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: [...FORMAT_KEYS], ...over });

describe("briefInputSchema", () => {
  it("rejects an empty topic, no formats, or an unknown format", () => {
    expect(briefInputSchema.safeParse({ title: "x", topic: "", audience: "a", language: "en", hookType: "question", formats: ["meta_feed"] }).success).toBe(false);
    expect(briefInputSchema.safeParse({ title: "x", topic: "t", audience: "a", language: "en", hookType: "question", formats: [] }).success).toBe(false);
    expect(briefInputSchema.safeParse({ title: "x", topic: "t", audience: "a", language: "en", hookType: "question", formats: ["myspace"] }).success).toBe(false);
  });
});

describe("generateKit (playbook templates, no AI)", () => {
  for (const language of ["en", "hinglish"] as const) {
    for (const hookType of HOOK_TYPES) {
      it(`${language} / ${hookType}: a master and one variant per format, within every limit, passing every rule`, () => {
        const kit = generateKit(brief({ language, hookType }), DEFAULT_BRAND_PROFILE);
        expect(kitSchema.safeParse(kit).success).toBe(true);
        expect(kit.master.hook.length).toBeGreaterThan(5);
        expect(kit.variants.map((v) => v.format).sort()).toEqual([...FORMAT_KEYS].sort());
        for (const v of kit.variants) {
          const limits = checkFieldLimits(v.format, v.fields);
          expect(limits.issues, `${v.format} limits`).toEqual([]);
          const res = checkCopyRules({ text: variantText(v.format, v.fields, v.disclaimer), language, settings: toRuleSettings(DEFAULT_BRAND_PROFILE) });
          expect(res.checks.filter((c) => c.status === "fail"), `${v.format} rules`).toEqual([]);
        }
      });
    }
  }

  it("builds only the formats asked for", () => {
    const kit = generateKit(brief({ formats: ["meta_feed"] }), DEFAULT_BRAND_PROFILE);
    expect(kit.variants).toHaveLength(1);
    expect(kit.variants[0].format).toBe("meta_feed");
  });

  it("uses the brief's own USP when given, and the disclaimer from the brand profile", () => {
    const kit = generateKit(brief({ usp: "Every step explained before you sign anything" }), DEFAULT_BRAND_PROFILE);
    expect(kit.master.usp).toBe("Every step explained before you sign anything");
    expect(kit.variants[0].disclaimer.startsWith(DEFAULT_BRAND_PROFILE.disclaimers.risk)).toBe(true);
    expect(kit.variants[0].disclaimer).toContain(DEFAULT_BRAND_PROFILE.disclaimers.plainRisk.en);
    expect(generateKit(brief({ language: "hinglish" }), DEFAULT_BRAND_PROFILE).variants[0].disclaimer).toContain(DEFAULT_BRAND_PROFILE.disclaimers.plainRisk.hinglish);
  });

  it("is deterministic", () => {
    expect(generateKit(brief(), DEFAULT_BRAND_PROFILE)).toEqual(generateKit(brief(), DEFAULT_BRAND_PROFILE));
  });

  it("a topic that breaks the rules is carried through so the checklist can show it", () => {
    const kit = generateKit(brief({ topic: "guaranteed returns on funds" }), DEFAULT_BRAND_PROFILE);
    const v = kit.variants[0];
    const res = checkCopyRules({ text: variantText(v.format, v.fields, v.disclaimer), language: "en" });
    expect(res.status).toBe("FAIL");
  });
});

describe("parseAiKit", () => {
  const ok = { master: { hook: "How does it work?", usp: "Plain language", cta: "Book a call" }, variants: [{ format: "meta_feed", fields: { primaryText: ["a"], headline: ["b"], description: ["c"] } }] };
  it("accepts a well-formed reply, even wrapped in a code fence", () => {
    expect(parseAiKit("```json\n" + JSON.stringify(ok) + "\n```").ok).toBe(true);
  });
  it("rejects prose, wrong shapes and unknown formats", () => {
    expect(parseAiKit("Sure! Here you go").ok).toBe(false);
    expect(parseAiKit(JSON.stringify({ master: {} })).ok).toBe(false);
    expect(parseAiKit(JSON.stringify({ ...ok, variants: [{ format: "x", fields: {} }] })).ok).toBe(false);
  });
});

describe("format table", () => {
  it("every format has fields", () => {
    for (const k of FORMAT_KEYS) expect(AD_FORMATS[k].fields.length).toBeGreaterThan(0);
  });
});
