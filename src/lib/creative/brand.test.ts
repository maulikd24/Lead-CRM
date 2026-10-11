import { describe, expect, it } from "vitest";

import { DEFAULT_BRAND_PROFILE, brandProfileSchema, nextProfileVersion, toRuleSettings, toPromptContext } from "./brand";

describe("brand profile", () => {
  it("the default profile is valid and carries a disclaimer, tone and audiences", () => {
    const p = brandProfileSchema.parse(DEFAULT_BRAND_PROFILE);
    expect(p.disclaimers.risk.length).toBeGreaterThan(20);
    expect(p.tone.voice.length).toBeGreaterThan(5);
    expect(p.audiences.length).toBeGreaterThan(0);
  });
  it("rejects a profile with no risk disclaimer", () => {
    expect(brandProfileSchema.safeParse({ ...DEFAULT_BRAND_PROFILE, disclaimers: { ...DEFAULT_BRAND_PROFILE.disclaimers, risk: "" } }).success).toBe(false);
  });
  it("turns into rule settings", () => {
    const s = toRuleSettings({ ...DEFAULT_BRAND_PROFILE, regulatedClaims: ["tax saving"], bannedWords: ["turbo"] });
    expect(s.regulatedClaims).toEqual(["tax saving"]);
    expect(s.bannedWords).toContain("turbo");
    expect(s.disclaimer).toBe(DEFAULT_BRAND_PROFILE.disclaimers.risk);
  });
  it("versions go up by one from the latest, starting at 1", () => {
    expect(nextProfileVersion([])).toBe(1);
    expect(nextProfileVersion([1, 3, 2])).toBe(4);
  });
  it("prompt context holds tone and audiences and no secrets or ids", () => {
    const c = toPromptContext(DEFAULT_BRAND_PROFILE);
    expect(c).toContain(DEFAULT_BRAND_PROFILE.tone.voice);
    expect(c).not.toMatch(/@|\b\d{10}\b/);
  });
});
