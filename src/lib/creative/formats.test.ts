import { describe, expect, it } from "vitest";

import { AD_FORMATS, FORMAT_KEYS, checkFieldLimits, counterState, variantText } from "./formats";

describe("ad formats", () => {
  it("covers Google search, Meta, LinkedIn, YouTube and TikTok", () => {
    expect(FORMAT_KEYS).toEqual(expect.arrayContaining(["google_rsa", "meta_feed", "linkedin_single", "youtube_video", "tiktok_feed"]));
    expect(AD_FORMATS.google_rsa.fields.find((f) => f.key === "headline")).toMatchObject({ max: 30 });
    expect(AD_FORMATS.google_rsa.fields.find((f) => f.key === "description")).toMatchObject({ max: 90 });
  });

  it("every field has a positive limit and a label", () => {
    for (const k of FORMAT_KEYS) for (const f of AD_FORMATS[k].fields) {
      expect(f.max).toBeGreaterThan(0);
      expect(f.label.length).toBeGreaterThan(1);
      expect(f.count.min).toBeLessThanOrEqual(f.count.max);
    }
  });
});

describe("checkFieldLimits", () => {
  it("passes copy within the limits", () => {
    const r = checkFieldLimits("google_rsa", { headline: ["How demat works", "Open in simple steps", "Plain-language help"], description: ["Learn the steps in plain language.", "Book a short call with our team."] });
    expect(r.ok).toBe(true);
  });
  it("reports a field that is too long, with its length and limit", () => {
    const r = checkFieldLimits("google_rsa", { headline: ["x".repeat(31), "b", "c"], description: ["d", "e"] });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ field: "headline", index: 0, length: 31, max: 30 });
  });
  it("reports too few or too many values for a repeated field", () => {
    expect(checkFieldLimits("google_rsa", { headline: ["a"], description: ["d", "e"] }).issues.some((i) => i.kind === "count" && i.field === "headline")).toBe(true);
    expect(checkFieldLimits("google_rsa", { headline: Array(16).fill("a"), description: ["d", "e"] }).issues.some((i) => i.kind === "count")).toBe(true);
  });
  it("counts characters the way people do (an emoji or a Devanagari letter is one)", () => {
    const r = checkFieldLimits("meta_feed", { primaryText: ["नमस्ते"], headline: ["Hi"], description: ["Hi"] });
    expect(r.ok).toBe(true);
  });
  it("a required field left empty is reported", () => {
    expect(checkFieldLimits("meta_feed", { primaryText: [""], headline: ["Hi"], description: ["Hi"] }).ok).toBe(false);
  });
});

describe("counterState", () => {
  it("is ok, near, then over", () => {
    expect(counterState(10, 30)).toBe("ok");
    expect(counterState(28, 30)).toBe("near");
    expect(counterState(31, 30)).toBe("over");
  });
});

describe("variantText", () => {
  it("joins every field and the disclaimer so the rules see all of the copy", () => {
    const t = variantText("meta_feed", { primaryText: ["A"], headline: ["B"], description: ["C"], cta: ["D"] }, "Risk line.");
    for (const part of ["A", "B", "C", "D", "Risk line."]) expect(t).toContain(part);
  });
});
