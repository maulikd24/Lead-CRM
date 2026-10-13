import { describe, expect, it, vi } from "vitest";

import type { CallInput, GatewayResult } from "@/lib/ai/gateway/types";
import { FakeProvider } from "@/lib/ai/provider";
import { callModel as gatewayCallModel } from "@/lib/ai/gateway/gateway";
import { makeDeps } from "@/lib/ai/gateway/test-kit";

import { CONVERSATION_DRAFT_PURPOSE, generateConversationDraft } from "./generate";
import type { DraftContext } from "./draft";

const ctx: DraftContext = {
  clientId: "client-1",
  firstName: "Riya",
  language: "English",
  kind: "conversation",
  acceptance: ["PMS: medium"],
  lastInteraction: { channel: "whatsapp", date: "2026-10-01" },
  pendingCommitments: 0,
  doNotDiscuss: ["PMS: customer is not ready for lock-in products"],
  openIssueKinds: [],
};

const okResult = (text: string) => ({ kind: "ok", text, toolUses: [], blocks: [], provider: "fake", model: "fake", usage: { inputTokens: 1, outputTokens: 1, costUsdEstimate: 0 }, runId: null, correlationId: "c" }) as unknown as GatewayResult;
const failed = (errorClass: string) => ({ kind: "failed", errorClass, retryable: false, attempts: 1, runId: null, correlationId: "c" }) as unknown as GatewayResult;
const blocked = (reason: string) => ({ kind: "blocked", reason, runId: null, correlationId: "c" }) as unknown as GatewayResult;
const abstain = (reason: string) => ({ kind: "abstain", reason, runId: null, correlationId: "c" }) as unknown as GatewayResult;

describe("the conversation draft goes through callModel with a named purpose", () => {
  it("calls the gateway with the conversation.draft purpose and the customer as subject", async () => {
    const callModel = vi.fn<(input: CallInput) => Promise<GatewayResult>>(async () => okResult("Hi Riya, checking in on your account. Any questions?"));
    await generateConversationDraft(ctx, { callModel });
    expect(callModel).toHaveBeenCalledTimes(1);
    const input = callModel.mock.calls[0][0];
    expect(input.purpose).toBe(CONVERSATION_DRAFT_PURPOSE);
    expect(input.subject).toEqual({ type: "client", id: "client-1" });
  });

  it("uses a clean model draft as the draft", async () => {
    const out = await generateConversationDraft(ctx, { callModel: async () => okResult("Hi Riya, checking in on your account. Any questions?") });
    expect(out).toMatchObject({ status: "draft", source: "model", body: "Hi Riya, checking in on your account. Any questions?" });
  });
});

describe("guardrail: a do-not-discuss topic is never in a draft (model output is checked, the template takes over)", () => {
  it("replaces a model draft that raises a do-not-discuss topic with the template", async () => {
    const out = await generateConversationDraft(ctx, { callModel: async () => okResult("Hi Riya, a PMS with lock-in could suit you.") });
    expect(out.status).toBe("draft");
    if (out.status !== "draft") return;
    expect(out.source).toBe("template");
    expect(out.body).not.toMatch(/PMS|lock-in/i);
    expect(out.note).toMatch(/model draft not used: uses a do-not-discuss topic/);
  });

  it("replaces a model draft that promises returns with the template", async () => {
    const out = await generateConversationDraft(ctx, { callModel: async () => okResult("Hi Riya, we guarantee returns this quarter.") });
    expect(out).toMatchObject({ status: "draft", source: "template" });
  });

  it("replaces an empty model reply with the template", async () => {
    const out = await generateConversationDraft(ctx, { callModel: async () => okResult("   ") });
    expect(out).toMatchObject({ status: "draft", source: "template" });
  });
});

describe("guardrail: a draft is refused for a client with an open complaint unless it is a service response", () => {
  it("refuses a sales conversation and never calls the model", async () => {
    const callModel = vi.fn(async () => okResult("unused"));
    const out = await generateConversationDraft({ ...ctx, openIssueKinds: ["complaint"] }, { callModel });
    expect(out.status).toBe("refused");
    expect(callModel).not.toHaveBeenCalled();
  });

  it("drafts a service response for the same client, with no sales context sent", async () => {
    const callModel = vi.fn<(input: CallInput) => Promise<GatewayResult>>(async () => okResult("Hi Riya, thank you for letting us know. We have noted your concern and a team member is reviewing it."));
    const out = await generateConversationDraft({ ...ctx, kind: "service_response", openIssueKinds: ["complaint"] }, { callModel });
    expect(out).toMatchObject({ status: "draft", kind: "service_response" });
    expect(callModel.mock.calls[0][0].user).not.toMatch(/acceptance|PMS/);
  });
});

describe("the draft falls back to the deterministic template when the model cannot help", () => {
  it("uses the template when no AI key is configured", async () => {
    const out = await generateConversationDraft(ctx, { callModel: async () => failed("not_configured") });
    expect(out).toMatchObject({ status: "draft", source: "template", note: "no AI key configured: template draft" });
  });

  it("uses the template when the model is unavailable", async () => {
    const out = await generateConversationDraft(ctx, { callModel: async () => failed("timeout") });
    expect(out).toMatchObject({ status: "draft", source: "template" });
  });

  it("uses the template when the spend budget is reached (an operating limit, not a customer rule)", async () => {
    const out = await generateConversationDraft(ctx, { callModel: async () => blocked("budget_exceeded") });
    expect(out).toMatchObject({ status: "draft", source: "template" });
  });
});

describe("the gateway's customer rules stop a draft", () => {
  it("does not draft when consent is denied", async () => {
    const out = await generateConversationDraft(ctx, { callModel: async () => blocked("consent_denied") });
    expect(out).toEqual({ status: "blocked", reason: "consent_denied" });
  });

  it("does not draft when the customer asked not to be contacted", async () => {
    const out = await generateConversationDraft(ctx, { callModel: async () => abstain("do_not_contact") });
    expect(out.status).toBe("refused");
  });
});

describe("the real gateway chain (purpose registered, consent checked, redaction on the way out)", () => {
  it("drafts through the real callModel when consent is in place", async () => {
    const kit = makeDeps({ provider: new FakeProvider("Hi Riya, checking in on your account. Any questions?") });
    const out = await generateConversationDraft(ctx, { callModel: (input) => gatewayCallModel(input, kit.deps) });
    expect(out).toMatchObject({ status: "draft", source: "model" });
    expect(kit.records[0]).toMatchObject({ purposeId: "conversation.draft", status: "ok" });
  });

  it("does not draft when the gateway's consent ledger says no", async () => {
    const kit = makeDeps({ provider: new FakeProvider("unused"), consent: async () => ({ allowed: false, reason: "DO_NOT_CONTACT" }) });
    const out = await generateConversationDraft(ctx, { callModel: (input) => gatewayCallModel(input, kit.deps) });
    expect(out.status).toBe("refused");
  });
});
