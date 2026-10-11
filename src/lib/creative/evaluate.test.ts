import { describe, expect, it } from "vitest";

import { DEFAULT_BRAND_PROFILE } from "./brand";
import { evaluateVariant } from "./evaluate";
import { briefInputSchema, generateKit } from "./kit";

const brief = briefInputSchema.parse({ title: "t", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: ["meta_feed", "google_rsa"] });
const kit = generateKit(brief, DEFAULT_BRAND_PROFILE);
const base = { profile: DEFAULT_BRAND_PROFILE, topic: brief.topic, language: "en" as const, referenceCopies: [] as string[] };

describe("evaluateVariant", () => {
  it("passes a generated variant with a score and a verdict", () => {
    const v = kit.variants[0];
    const r = evaluateVariant({ ...base, format: v.format, fields: v.fields, disclaimer: v.disclaimer });
    expect(r.complianceStatus).toBe("PASS");
    expect(r.verdict).toBe("scale");
    expect(r.checks.some((c) => c.id === "within_limits" && c.status === "pass")).toBe(true);
  });

  it("fails when a field is over its limit, and names the field", () => {
    const v = kit.variants.find((x) => x.format === "meta_feed")!;
    const r = evaluateVariant({ ...base, format: v.format, fields: { ...v.fields, headline: ["h".repeat(60)] }, disclaimer: v.disclaimer });
    expect(r.complianceStatus).toBe("FAIL");
    const c = r.checks.find((x) => x.id === "within_limits")!;
    expect(c.status).toBe("fail");
    expect(c.matched).toMatch(/Headline/);
  });

  it("fails when the disclaimer is dropped", () => {
    const v = kit.variants[0];
    const r = evaluateVariant({ ...base, format: v.format, fields: v.fields, disclaimer: "" });
    expect(r.checks.find((c) => c.id === "risk_disclosure")!.status).toBe("fail");
    expect(r.complianceStatus).toBe("FAIL");
  });

  it("fails copy that echoes a competitor reference too closely", () => {
    const v = kit.variants.find((x) => x.format === "meta_feed")!;
    const text = "Is your portfolio really working for you or just sitting there quietly";
    const r = evaluateVariant({ ...base, format: v.format, fields: { ...v.fields, primaryText: ["Is your portfolio really working for you or just sitting there"] }, disclaimer: v.disclaimer, referenceCopies: [text] });
    expect(r.checks.find((c) => c.id === "originality")!.status).toBe("fail");
  });

  it("without references the originality rule is not applicable", () => {
    const v = kit.variants[0];
    const r = evaluateVariant({ ...base, format: v.format, fields: v.fields, disclaimer: v.disclaimer });
    expect(r.checks.find((c) => c.id === "originality")!.status).toBe("not_applicable");
  });

  it("a compliance failure forces the rewrite verdict", () => {
    const v = kit.variants[0];
    const r = evaluateVariant({ ...base, format: v.format, fields: { ...v.fields, headline: ["Guaranteed returns", "x", "y"] }, disclaimer: v.disclaimer });
    expect(r.verdict).toBe("rewrite");
  });
});
