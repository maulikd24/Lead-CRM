import { describe, expect, it } from "vitest";

import { GatewayProvider } from "@/lib/ai/gateway/adapter";
import { PURPOSES, getPurpose } from "@/lib/ai/gateway/purposes";
import { makeDeps } from "@/lib/ai/gateway/test-kit";
import { FakeProvider } from "@/lib/ai/provider";
import { ACTION_TYPES } from "@/lib/agents/autonomy";
import { AGENTS, getAgent } from "@/lib/agents/registry";

import { DEFAULT_BRAND_PROFILE } from "./brand";
import { generateKitWithAi, suggestTagsWithAi } from "./ai";
import { briefInputSchema } from "./kit";

/**
 * Creative drafts go through callModel(): the brief generator, the copy drafter and the tag suggester each name a registered purpose, belong to
 * a registered agent (L3 draft only, nothing is published or sent), and handle the gateway's refusals (kill switch, budget, abstain) as ordinary
 * outcomes. Nothing here talks to a vendor SDK.
 */
const input = briefInputSchema.parse({ title: "t", topic: "opening a demat account", audience: "first-time investors", language: "en", hookType: "question", formats: ["meta_feed"] });
const master = { hook: "Not sure how a demat account works?", usp: "Plain steps, no pressure.", cta: "Book a 15-minute call" };
const variants = { variants: [{ format: "meta_feed", fields: { primaryText: ["Learn how opening a demat account works, one step at a time."], headline: ["Demat, step by step"], description: ["No pressure."], cta: ["Learn more"] } }] };
const scripted = (over: { brief?: string; copy?: string; judge?: string; tags?: string } = {}) =>
  new FakeProvider((req) => {
    const purpose = req.gateway?.purpose;
    if (purpose === "compliance.judge") return over.judge ?? "SAFE";
    if (purpose === "creative.brief") return over.brief ?? JSON.stringify(master);
    if (purpose === "creative.copy") return over.copy ?? JSON.stringify(variants);
    if (purpose === "creative.tags") return over.tags ?? '{"hook":"question"}';
    throw new Error(`unexpected purpose ${String(purpose)}`);
  });
const on = async () => true;

describe("purposes and agent registry entries", () => {
  it("registers the brief generator, the copy drafter and the tag suggester, none of which is shown customer data", () => {
    for (const id of ["creative.brief", "creative.copy", "creative.tags"]) {
      const p = getPurpose(id)!;
      expect(p, id).toBeDefined();
      expect(p.agentKey, id).toBe("creative_drafter");
      expect(p.dataClass, id).toBe("none");
      expect(p.consent, id).toBeNull();
      expect(p.allowNames && p.allowContactIdentifiers, id).toBeFalsy();
    }
    expect(PURPOSES.filter((p) => p.id.startsWith("creative.")).length).toBe(3);
  });
  it("the two drafting purposes tell the model it may abstain, and the gateway turns that into an abstain result", () => {
    expect(getPurpose("creative.brief")!.abstainProtocol).toBe(true);
    expect(getPurpose("creative.copy")!.abstainProtocol).toBe(true);
  });
  it("the agent is registered, L3 draft only: no action above L3, no publishing, no ad spend, approval always", () => {
    const a = getAgent("creative_drafter")!;
    expect(a).toBeDefined();
    expect(a.purposes.sort()).toEqual(["compliance.judge", "creative.brief", "creative.copy", "creative.tags"]);
    for (const e of a.actions) { expect(e.maxLevel, e.actionType).toBeLessThanOrEqual(3); expect(e.defaultLevel, e.actionType).toBeLessThanOrEqual(3); }
    expect(a.approval.required).toBe("always");
    expect(a.prohibitedActions).toEqual(expect.arrayContaining(["send_message", "change_ad_spend", "publish_ad"]));
    expect(a.dataPermissions.dataClassCeiling).toBe("none");
    expect(a.killSwitch).toMatchObject({ kind: "flag_and_setting", envFlag: "NEXT_PUBLIC_CREATIVE_INTEL", settingKey: "creative_drafter" });
    expect(ACTION_TYPES.draft_ad_copy.class).toBe("customer_send");
    expect(AGENTS.filter((x) => x.key === "creative_drafter")).toHaveLength(1);
  });
});

describe("every model request names its registered purpose", () => {
  it("kit generation makes a brief call, then a copy call, then a judge call, each with a registered purpose and a shared correlation id", async () => {
    const p = scripted();
    const r = await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider: p, isEnabled: on });
    expect(r.ok).toBe(true);
    expect(p.calls.map((c) => c.gateway?.purpose)).toEqual(["creative.brief", "creative.copy", "compliance.judge"]);
    for (const c of p.calls) expect(getPurpose(c.gateway!.purpose), c.gateway!.purpose).toBeDefined();
    expect(new Set(p.calls.map((c) => c.gateway?.correlationId)).size).toBe(1);
    expect(p.calls[0].gateway?.correlationId).toBeTruthy();
  });
  it("the copy call is given the master the brief call produced, not the raw brief alone", async () => {
    const p = scripted({ brief: JSON.stringify({ ...master, hook: "A hook only the brief call wrote" }) });
    await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider: p, isEnabled: on });
    expect(p.calls[1].user).toContain("A hook only the brief call wrote");
  });
  it("tag suggestions name creative.tags", async () => {
    const p = scripted();
    expect(await suggestTagsWithAi({ name: "Demat basics video", format: "VIDEO" }, { provider: p, isEnabled: on })).toEqual({ ok: true, tags: { hook: "question" } });
    expect(p.calls[0].gateway?.purpose).toBe("creative.tags");
  });
});

describe("through the real gateway: refusals are outcomes, not crashes", () => {
  /** The gateway's own deps with a scripted vendor: replies are consumed in call order (brief, copy, judge). */
  const through = (replies: string[], over: Parameters<typeof makeDeps>[0] = {}) => {
    const kit = makeDeps(over);
    let i = 0;
    kit.deps.providerFor = () => new FakeProvider(() => replies[Math.min(i++, replies.length - 1)]);
    return { provider: new GatewayProvider({ deps: () => kit.deps }), kit };
  };
  it("a draft passes end to end and leaves AgentRun trace rows for the three calls", async () => {
    const { provider, kit } = through([JSON.stringify(master), JSON.stringify(variants), "SAFE"]);
    const r = await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider, isEnabled: on });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(kit.records.map((x) => x.purposeId)).toEqual(["creative.brief", "creative.copy", "compliance.judge"]);
  });
  it("the model abstaining is reported as abstained, with a plain reason, and nothing is drafted", async () => {
    const { provider } = through(["ABSTAIN: do_not_know"]);
    const r = await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider, isEnabled: on });
    expect(r).toMatchObject({ ok: false, reason: "abstained" });
    if (!r.ok) expect(r.detail).toMatch(/not enough information/i);
  });
  it("the per-purpose kill switch is a blocked outcome", async () => {
    const { provider } = through([JSON.stringify(master)], { agentEnabled: async () => false });
    const r = await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider, isEnabled: on });
    expect(r).toMatchObject({ ok: false, reason: "blocked" });
    if (!r.ok) expect(r.detail).toMatch(/switched off/i);
  });
  it("a spent budget is a blocked outcome", async () => {
    const { provider } = through([JSON.stringify(master)], { spentToday: async () => 1_000_000 });
    expect(await generateKitWithAi(input, DEFAULT_BRAND_PROFILE, { provider, isEnabled: on })).toMatchObject({ ok: false, reason: "blocked" });
  });
  it("tag suggestions fail soft when the gateway refuses", async () => {
    const { provider } = through(["{}"], { agentEnabled: async () => false });
    expect(await suggestTagsWithAi({ name: "x", format: "" }, { provider, isEnabled: on })).toMatchObject({ ok: false });
  });
});
