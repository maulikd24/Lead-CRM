import { describe, expect, it, vi } from "vitest";

import type { CallInput, GatewayResult } from "@/lib/ai/gateway/types";
import { FakeProvider } from "@/lib/ai/provider";
import { callModel as gatewayCallModel } from "@/lib/ai/gateway/gateway";
import { makeDeps } from "@/lib/ai/gateway/test-kit";

import { CONVERSATION_DRAFT_PURPOSE, generateConversationDraft } from "./generate";
import { JUDGE_PURPOSE } from "./judge";
import type { DraftContext } from "./draft";

const ctx: DraftContext = {
  clientId: "client-1",
  firstName: "Riya",
  language: "English",
  kind: "conversation",
  acceptance: ["PMS: medium"],
  lastInteraction: { channel: "whatsapp", date: "2026-10-01" },
  pendingCommitments: 0,
  blockedAssetClasses: ["PMS"],
  blockedTopics: [],
  openIssueKinds: [],
};

const CLEAN = "Hi Riya, checking in on your account. Any questions?";
const ok = (text: string) => ({ kind: "ok", text, toolUses: [], blocks: [], provider: "fake", model: "fake", usage: { inputTokens: 1, outputTokens: 1, costUsdEstimate: 0 }, runId: null, correlationId: "c" }) as unknown as GatewayResult;
const failed = (errorClass: string) => ({ kind: "failed", errorClass, retryable: false, attempts: 1, runId: null, correlationId: "c" }) as unknown as GatewayResult;
const blocked = (reason: string) => ({ kind: "blocked", reason, runId: null, correlationId: "c" }) as unknown as GatewayResult;
const abstain = (reason: string) => ({ kind: "abstain", reason, runId: null, correlationId: "c" }) as unknown as GatewayResult;

/** A model that answers the drafter with `draft` and the judge with `judge` (or the given result). */
function router(draft: GatewayResult | ((i: CallInput) => GatewayResult), judge: GatewayResult | string = "SAFE") {
  return vi.fn<(input: CallInput) => Promise<GatewayResult>>(async (input) => {
    if (input.purpose === JUDGE_PURPOSE) return typeof judge === "string" ? ok(judge) : judge;
    return typeof draft === "function" ? draft(input) : draft;
  });
}

const purposes = (m: ReturnType<typeof router>) => m.mock.calls.map((c) => c[0].purpose);

describe("the conversation draft goes through callModel with a named purpose, and the judge checks model drafts", () => {
  it("calls the drafter with the conversation.draft purpose and the customer as subject", async () => {
    const callModel = router(ok(CLEAN));
    await generateConversationDraft(ctx, { callModel });
    const draftCall = callModel.mock.calls.find((c) => c[0].purpose === CONVERSATION_DRAFT_PURPOSE);
    expect(draftCall?.[0].subject).toEqual({ type: "client", id: "client-1" });
  });

  it("uses a clean model draft once the judge says SAFE", async () => {
    const callModel = router(ok(CLEAN), "SAFE");
    const out = await generateConversationDraft(ctx, { callModel });
    expect(out).toMatchObject({ status: "draft", source: "model", body: CLEAN });
    expect(purposes(callModel)).toEqual([CONVERSATION_DRAFT_PURPOSE, JUDGE_PURPOSE]);
  });

  it("replaces a model draft the judge marks UNSAFE with the template", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(ok(CLEAN), "UNSAFE: implies a return") });
    expect(out).toMatchObject({ status: "draft", source: "template" });
    expect(out.status === "draft" && out.note).toMatch(/model draft not used: judge: UNSAFE/);
  });

  it("refuses a draft (stores nothing) when the judge is unavailable: fail closed", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(ok(CLEAN), failed("timeout")) });
    expect(out).toMatchObject({ status: "refused" });
    expect(out.status === "refused" && out.reason).toMatch(/compliance judge unavailable/);
  });

  it("refuses when the judge gives an empty verdict", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(ok(CLEAN), "   ") });
    expect(out.status).toBe("refused");
  });

  it("does not call the judge for a deterministic template (rule checks alone)", async () => {
    const callModel = router(failed("not_configured"));
    const out = await generateConversationDraft(ctx, { callModel });
    expect(out).toMatchObject({ status: "draft", source: "template", note: "no AI key configured: template draft" });
    expect(purposes(callModel)).toEqual([CONVERSATION_DRAFT_PURPOSE]);
  });
});

describe("guardrail: a do-not-discuss asset class is never in a draft (model output is checked, the template takes over)", () => {
  it("replaces a model draft that raises a blocked asset class with the template", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(ok("Hi Riya, a PMS with lock-in could help you.")) });
    expect(out.status).toBe("draft");
    if (out.status !== "draft") return;
    expect(out.source).toBe("template");
    expect(out.body).not.toMatch(/PMS|lock-in/i);
    expect(out.note).toMatch(/model draft not used: uses a do-not-discuss topic \(PMS\)/);
  });

  it("replaces a model draft that promises returns with the template", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(ok("Hi Riya, we guarantee returns this quarter.")) });
    expect(out).toMatchObject({ status: "draft", source: "template" });
  });

  it("replaces an empty model reply with the template", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(ok("   ")) });
    expect(out).toMatchObject({ status: "draft", source: "template" });
  });

  it("the drafter prompt carries the blocked asset classes as hard constraints", async () => {
    const callModel = router(ok(CLEAN));
    await generateConversationDraft(ctx, { callModel });
    const draftCall = callModel.mock.calls.find((c) => c[0].purpose === CONVERSATION_DRAFT_PURPOSE);
    expect(draftCall?.[0].user).toContain('"blockedAssetClasses":["PMS"]');
  });
});

describe("guardrail: a recommendation in a conversation draft is refused and routed to an RM", () => {
  it("refuses a model recommendation with routeToHandover, and the judge is not called", async () => {
    const callModel = router(ok("Hi Riya, now is a good time to add to your holdings."));
    const out = await generateConversationDraft({ ...ctx, blockedAssetClasses: [] }, { callModel });
    expect(out).toMatchObject({ status: "refused", routeToHandover: true });
    expect(purposes(callModel)).toEqual([CONVERSATION_DRAFT_PURPOSE]);
  });

  it("does not route a service response to handover (it falls back to the template)", async () => {
    const out = await generateConversationDraft(
      { ...ctx, kind: "service_response", openIssueKinds: ["complaint"], blockedAssetClasses: [] },
      { callModel: router(ok("Hi Riya, a good time to add would be now.")) },
    );
    expect(out).toMatchObject({ status: "draft", source: "template" });
  });
});

describe("guardrail: a draft is refused for a client with an open complaint unless it is a service response", () => {
  it("refuses a sales conversation and never calls the model", async () => {
    const callModel = router(ok("unused"));
    const out = await generateConversationDraft({ ...ctx, openIssueKinds: ["complaint"] }, { callModel });
    expect(out.status).toBe("refused");
    expect(callModel).not.toHaveBeenCalled();
  });

  it("drafts a service response for the same client, with no sales context sent", async () => {
    const callModel = router(ok("Hi Riya, thank you for letting us know. We have noted your concern and a team member is reviewing it."));
    const out = await generateConversationDraft({ ...ctx, kind: "service_response", openIssueKinds: ["complaint"] }, { callModel });
    expect(out).toMatchObject({ status: "draft", kind: "service_response" });
    expect(callModel.mock.calls[0][0].user).not.toMatch(/acceptance|PMS/);
  });
});

describe("guardrail: a sales block refuses every conversation draft for the customer, without a model call", () => {
  it("refuses a conversation when the sales block is set", async () => {
    const callModel = router(ok("unused"));
    const out = await generateConversationDraft({ ...ctx, blockedTopics: ["sales"] }, { callModel });
    expect(out).toEqual({ status: "refused", reason: "sales topics are set aside for this customer" });
    expect(callModel).not.toHaveBeenCalled();
  });
});

describe("the draft falls back to the deterministic template when the model cannot help", () => {
  it("uses the template when the model is unavailable", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(failed("timeout")) });
    expect(out).toMatchObject({ status: "draft", source: "template" });
  });

  it("uses the template when the spend budget is reached (an operating limit, not a customer rule)", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(blocked("budget_exceeded")) });
    expect(out).toMatchObject({ status: "draft", source: "template" });
  });

  it("blocks with no template when the kill switch is on (nothing is written)", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(blocked("kill_switch")) });
    expect(out).toEqual({ status: "blocked", reason: "kill_switch" });
  });
});

describe("the gateway's customer rules stop a draft", () => {
  it("does not draft when consent is denied", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(blocked("consent_denied")) });
    expect(out).toEqual({ status: "blocked", reason: "consent_denied" });
  });

  it("does not draft when the customer asked not to be contacted", async () => {
    const out = await generateConversationDraft(ctx, { callModel: router(abstain("do_not_contact")) });
    expect(out.status).toBe("refused");
  });
});

describe("the real gateway chain (purposes registered, consent checked, redaction on the way out)", () => {
  it("drafts through the real callModel when consent is in place and the judge says SAFE", async () => {
    const kit = makeDeps({ provider: new FakeProvider((req) => (req.system.includes("compliance reviewer") ? "SAFE" : CLEAN)) });
    const out = await generateConversationDraft(ctx, { callModel: (input) => gatewayCallModel(input, kit.deps) });
    expect(out).toMatchObject({ status: "draft", source: "model" });
    expect(kit.records.map((r) => r.purposeId)).toEqual([CONVERSATION_DRAFT_PURPOSE, JUDGE_PURPOSE]);
  });

  it("does not draft when the gateway's consent ledger says no", async () => {
    const kit = makeDeps({ provider: new FakeProvider("unused"), consent: async () => ({ allowed: false, reason: "DO_NOT_CONTACT" }) });
    const out = await generateConversationDraft(ctx, { callModel: (input) => gatewayCallModel(input, kit.deps) });
    expect(out.status).toBe("refused");
  });
});
