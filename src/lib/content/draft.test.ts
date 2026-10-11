import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { callModel, type CallInput, type GatewayResult } from "@/lib/ai/gateway";
import { getPurpose } from "@/lib/ai/gateway/purposes";
import { makeDeps } from "@/lib/ai/gateway/test-kit";
import { FakeProvider } from "@/lib/ai/provider";

import * as contentModule from "./index";
import { CONTENT_ENGINE_FLAG, contentEngineEnabled } from "./flag";
import type { ContentBrief } from "./brief";
import { CONTENT_PURPOSE, draftContent } from "./draft";

const brief: ContentBrief = {
  briefId: "brief-1",
  product: "A monthly investment plan",
  audience: "First-time investors",
  promise: "Understand how a monthly plan works before you decide",
  channel: "post",
  approved: true,
};

/** A gateway call backed by the offline fake provider. The spy records every input the gateway receives. */
function gatewayWith(reply: string, over: Record<string, unknown> = {}) {
  const kit = makeDeps({ provider: new FakeProvider(reply), ...over });
  const seen: CallInput[] = [];
  const call = async (input: CallInput): Promise<GatewayResult> => {
    seen.push(input);
    return callModel(input, kit.deps);
  };
  return { call, seen };
}

describe("the flag", () => {
  it("is off by default and on only for the exact value 1", () => {
    expect(CONTENT_ENGINE_FLAG).toBe("CONTENT_ENGINE_ENABLED");
    expect(contentEngineEnabled({})).toBe(false);
    expect(contentEngineEnabled({ CONTENT_ENGINE_ENABLED: "yes" })).toBe(false);
    expect(contentEngineEnabled({ CONTENT_ENGINE_ENABLED: "1" })).toBe(true);
  });
  it("makes no model call while off", async () => {
    const { call, seen } = gatewayWith("Learn how a monthly plan works.");
    const r = await draftContent(brief, { enabled: false, call });
    expect(r).toEqual({ ok: false, reason: "disabled" });
    expect(seen).toHaveLength(0);
  });
});

describe("the brief must be approved", () => {
  it("refuses an unapproved brief before any model is called", async () => {
    const { call, seen } = gatewayWith("Learn how a monthly plan works.");
    const r = await draftContent({ ...brief, approved: false }, { enabled: true, call });
    expect(r).toMatchObject({ ok: false, reason: "brief_not_approved" });
    expect(seen).toHaveLength(0);
  });
  it("refuses an unknown channel or an empty field", async () => {
    const { call, seen } = gatewayWith("Learn how a monthly plan works.");
    expect(await draftContent({ ...brief, channel: "tv" as never }, { enabled: true, call })).toMatchObject({ ok: false, reason: "invalid_brief" });
    expect(await draftContent({ ...brief, promise: "  " }, { enabled: true, call })).toMatchObject({ ok: false, reason: "invalid_brief" });
    expect(seen).toHaveLength(0);
  });
});

describe("a draft from the gateway", () => {
  it("calls the gateway with the content.draft purpose and returns DRAFT that needs approval", async () => {
    const { call, seen } = gatewayWith("Learn how a monthly plan works, at your own pace.");
    const r = await draftContent(brief, { enabled: true, call });
    expect(seen).toHaveLength(1);
    expect(seen[0].purpose).toBe(CONTENT_PURPOSE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.status).toBe("DRAFT");
    expect(r.draft.requiresApproval).toBe(true);
    expect(r.draft.passed).toBe(true);
    expect(r.draft.reasons).toEqual([]);
    expect(r.draft.body).toContain("Learn how a monthly plan works");
  });
  it("always appends the mandatory risk line, in code", async () => {
    const { call } = gatewayWith("Learn how a monthly plan works.");
    const r = await draftContent(brief, { enabled: true, call });
    if (!r.ok) throw new Error("expected a draft");
    expect(r.draft.body).toMatch(/subject to market risks/i);
    expect(r.draft.guardrail.checks.find((c) => c.id === "risk_disclosure")?.status).toBe("pass");
  });
  it("returns a draft that fails the guardrail WITH its reasons, not dropped", async () => {
    const { call } = gatewayWith("Guaranteed returns of 12 percent, every year. Invest now.");
    const r = await draftContent(brief, { enabled: true, call });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.status).toBe("DRAFT");
    expect(r.draft.requiresApproval).toBe(true);
    expect(r.draft.passed).toBe(false);
    expect(r.draft.guardrail.status).toBe("FAIL");
    expect(r.draft.reasons.some((x) => x.includes("guaranteed"))).toBe(true);
    expect(r.draft.reasons.length).toBeGreaterThan(0);
  });
  it("flags a draft that is too long for the channel, with the reason", async () => {
    const { call } = gatewayWith("Learn how a monthly plan works. ".repeat(40));
    const r = await draftContent({ ...brief, channel: "ad" }, { enabled: true, call });
    if (!r.ok) throw new Error("expected a draft");
    expect(r.draft.passed).toBe(false);
    expect(r.draft.reasons.some((x) => x.includes("Too long"))).toBe(true);
  });
  it("refuses, with a reason, when the model abstains or the gateway is switched off", async () => {
    const abstain = gatewayWith("ABSTAIN: human_review_required");
    expect(await draftContent(brief, { enabled: true, call: abstain.call })).toMatchObject({ ok: false, reason: "abstained" });
    const killed = gatewayWith("Learn how a monthly plan works.", { env: { AI_BUDGET_DEFAULT_USD: "100", AI_KILL_SWITCH: "1" } });
    expect(await draftContent(brief, { enabled: true, call: killed.call })).toMatchObject({ ok: false, reason: "blocked" });
  });
  it("refuses an empty model reply rather than storing nothing", async () => {
    const { call } = gatewayWith("   ");
    expect(await draftContent(brief, { enabled: true, call })).toMatchObject({ ok: false, reason: "no_draft" });
  });
});

describe("the content engine has no publish path", () => {
  const dir = path.resolve(process.cwd(), "src/lib/content");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => ({ f, text: readFileSync(path.join(dir, f), "utf8") }));

  it("exports nothing that publishes, schedules, sends or dispatches", () => {
    for (const name of Object.keys(contentModule)) expect(name, name).not.toMatch(/publish|schedul|send|dispatch|deliver/i);
  });
  it("contains no call to a publish, schedule, send or dispatch function", () => {
    for (const { f, text } of sources) expect(text, f).not.toMatch(/\b(?:publish|schedule|send|dispatch|deliver)\w*\s*\(/i);
  });
  it("imports no messaging, social or ad-platform module, and never a provider directly", () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/from\s+["'][^"']*(?:whatsapp|messaging|social|meta|google-ads|gmail|email|push|notifications)[^"']*["']/i);
      expect(text, f).not.toMatch(/from\s+["'](?:openai|@anthropic-ai\/sdk|@google\/generative-ai)[^"']*["']/);
      expect(text, f).not.toMatch(/from\s+["']@\/lib\/ai\/provider["']/);
    }
  });
  it("registers the purpose for drafts only: no customer data, no consent, no names", () => {
    const p = getPurpose(CONTENT_PURPOSE);
    expect(p).toBeDefined();
    expect(p?.dataClass).toBe("none");
    expect(p?.consent).toBeNull();
    expect(p?.allowNames).toBe(false);
  });
});
