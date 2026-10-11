import { describe, expect, it } from "vitest";

import { FakeProvider } from "@/lib/ai/provider";

import { DEFAULT_BRAND_PROFILE } from "./brand";
import { generateKitWithAi, suggestTagsWithAi } from "./ai";
import { briefInputSchema } from "./kit";

const input = briefInputSchema.parse({ title: "t", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: ["meta_feed", "google_rsa"] });
const goodKit = { master: { hook: "Not sure how a demat account works?", usp: "Plain steps, no pressure.", cta: "Book a 15-minute call" }, variants: [{ format: "meta_feed", fields: { primaryText: ["Learn how opening a demat account works."], headline: ["Demat, step by step"], description: ["Plain steps"], cta: ["Learn more"] } }] };

const provider = (kit: unknown = goodKit, judge = "SAFE") =>
  new FakeProvider((req) => {
    const purpose = req.gateway?.purpose;
    if (purpose === "compliance.judge") return judge;
    if (typeof kit === "string") return kit;
    const k = kit as { master: unknown; variants: unknown };
    return purpose === "creative.brief" ? JSON.stringify(k.master) : JSON.stringify({ variants: k.variants });
  });
const on = async () => true;

describe("generateKitWithAi", () => {
  it("is off unless the kill switch says on", async () => {
    expect(await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider: provider(), isEnabled: async () => false })).toMatchObject({ ok: false, reason: "disabled" });
  });

  it("uses the model's variants, adds the disclaimer in code, and fills formats the model left out from the templates", async () => {
    const r = await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider: provider(), isEnabled: on });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kit.variants.map((v) => v.format).sort()).toEqual(["google_rsa", "meta_feed"]);
    for (const v of r.kit.variants) expect(v.disclaimer.startsWith(DEFAULT_BRAND_PROFILE.disclaimers.risk)).toBe(true);
    expect(r.kit.variants.find((v) => v.format === "meta_feed")!.fields.headline).toEqual(["Demat, step by step"]);
  });

  it("drops formats nobody asked for", async () => {
    const extra = { ...goodKit, variants: [...goodKit.variants, { format: "tiktok_feed", fields: { adText: ["x"] } }] };
    const r = await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider: provider(extra), isEnabled: on });
    expect(r.ok && r.kit.variants.some((v) => v.format === "tiktok_feed")).toBe(false);
  });

  it("only the scrubbed brief and the formats go to the vendor", async () => {
    const p = provider();
    const dirty = { ...input, topic: "opening a demat account, call 9876543210 or mail a@b.com", audience: "ABCDE1234F holders" };
    await generateKitWithAi(dirty, DEFAULT_BRAND_PROFILE, { provider: p, isEnabled: on });
    const sent = p.calls.map((c) => c.user + c.system).join(" ");
    expect(sent).not.toMatch(/9876543210|a@b\.com|ABCDE1234F/);
  });

  it("fails closed on a provider error, prose, or an unsafe verdict", async () => {
    expect(await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider: new FakeProvider(new Error("down")), isEnabled: on })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider: provider("Sure, here is an ad"), isEnabled: on })).toMatchObject({ ok: false, reason: "no_draft" });
    expect(await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider: provider(goodKit, "UNSAFE: promises returns"), isEnabled: on })).toMatchObject({ ok: false, reason: "unsafe" });
  });

  it("tells the model the limits, the brand voice and the hard rules", async () => {
    const p = provider();
    await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider: p, isEnabled: on });
    const sys = p.calls[1].system;
    expect(sys).toMatch(/30/);
    expect(sys).toContain(DEFAULT_BRAND_PROFILE.tone.voice);
    expect(sys).toMatch(/no guaranteed|never promise/i);
  });
});

describe("suggestTagsWithAi", () => {
  it("returns only vocabulary values, as drafts material", async () => {
    const r = await suggestTagsWithAi({ name: "Demat basics video", format: "VIDEO" }, { provider: new FakeProvider('{"hook":"question","format":"video","offer":"nonsense"}'), isEnabled: on });
    expect(r).toEqual({ ok: true, tags: { hook: "question", format: "video" } });
  });
  it("is off when disabled and fails soft on errors", async () => {
    expect(await suggestTagsWithAi({ name: "x", format: "" }, { provider: new FakeProvider("{}"), isEnabled: async () => false })).toMatchObject({ ok: false });
    expect(await suggestTagsWithAi({ name: "x", format: "" }, { provider: new FakeProvider(new Error("down")), isEnabled: on })).toMatchObject({ ok: false });
  });
});
