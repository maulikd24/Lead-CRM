import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  callModel: vi.fn(),
  buildAgentBriefing: vi.fn(),
  requestApproval: vi.fn(),
  recordInteractionOutcome: vi.fn(),
  taskFindFirst: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: { task: { findFirst: m.taskFindFirst } } }));
vi.mock("@/lib/ai/gateway", () => ({ callModel: m.callModel }));
vi.mock("@/lib/intelligence/agent", () => ({ buildAgentBriefing: m.buildAgentBriefing }));
vi.mock("@/lib/intelligence/outcomes", () => ({ recordInteractionOutcome: m.recordInteractionOutcome }));
vi.mock("@/lib/policy/approvals/service", () => ({ requestApproval: m.requestApproval }));
vi.mock("@/lib/policy/approvals/registry-init", () => ({}));

import type { GatewayResult } from "@/lib/ai/gateway/types";
import { CUSTOMER_MESSAGE_DRAFT, dispatchApprovedDraft, type ApprovalRequestRow, type DraftPayload } from "./approval";
import { draftConversationForClient, handOverConversationForClient, requestDraftApprovalForClient } from "./wiring";

const RM = { id: "rm-1", role: "RM" as const };
const NOW = new Date("2026-10-14T10:00:00Z");

/** A briefing with no blocks, no issues, one prior contact. Each test overrides what it needs. */
function briefing(over: Partial<Record<string, unknown>> = {}) {
  return {
    customer: { id: "client-1", name: "Riya Shah", preferredLanguage: "English" },
    whyContactingNow: { programme: "Portfolio check-in" },
    mustNotDiscuss: [],
    mustNotDiscussKeys: [],
    assetClassAcceptance: {},
    recentInteractions: [{ channel: "WHATSAPP", date: "2026-10-01" }],
    pendingCommitments: [],
    openIssues: [],
    ...over,
  };
}

const failedGateway = { kind: "failed", errorClass: "not_configured", retryable: false, attempts: 1, runId: null, correlationId: "c" } as unknown as GatewayResult;
const okGateway = (text: string) => ({ kind: "ok", text, toolUses: [], blocks: [], provider: "p", model: "m", usage: { inputTokens: 1, outputTokens: 1, costUsdEstimate: 0 }, runId: null, correlationId: "c" }) as unknown as GatewayResult;

beforeEach(() => {
  vi.clearAllMocks();
  m.callModel.mockResolvedValue(failedGateway); // no AI key: the deterministic template is the draft
  m.requestApproval.mockResolvedValue({ id: "ar-1" });
  m.recordInteractionOutcome.mockResolvedValue({});
  m.taskFindFirst.mockResolvedValue(null);
});

describe("draftConversationForClient: a refused draft creates no approval", () => {
  it("refuses a customer with a sales block: no model call, no approval", async () => {
    m.buildAgentBriefing.mockResolvedValue(briefing({ mustNotDiscuss: ["Sales"], mustNotDiscussKeys: ["sales"] }));
    const { outcome, approvalRequestId } = await draftConversationForClient("client-1", RM, "conversation");
    expect(outcome).toMatchObject({ status: "refused", reason: expect.stringContaining("sales topics are set aside") });
    expect(approvalRequestId).toBeNull();
    expect(m.callModel).not.toHaveBeenCalled();
    expect(m.requestApproval).not.toHaveBeenCalled();
  });

  it("refuses a sales draft when an open complaint is on record: no approval", async () => {
    m.buildAgentBriefing.mockResolvedValue(briefing({ openIssues: [{ kind: "complaint" }] }));
    const { outcome, approvalRequestId } = await draftConversationForClient("client-1", RM, "conversation");
    expect(outcome).toMatchObject({ status: "refused", reason: expect.stringContaining("open complaint") });
    expect(approvalRequestId).toBeNull();
    expect(m.requestApproval).not.toHaveBeenCalled();
  });

  it("a recommendation written by the model is refused, handed to the RM, and stores no approval", async () => {
    m.buildAgentBriefing.mockResolvedValue(briefing());
    m.callModel.mockResolvedValue(okGateway("This is a good time to add to your PMS holding."));
    const { outcome, approvalRequestId } = await draftConversationForClient("client-1", RM, "conversation");
    expect(outcome).toMatchObject({ status: "refused", routeToHandover: true });
    expect(approvalRequestId).toBeNull();
    expect(m.requestApproval).not.toHaveBeenCalled();
    expect(m.recordInteractionOutcome).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-1", outcome: "RM_HANDOVER" }));
  });

  it("with storeApproval false, a clean draft is returned for review and nothing is stored", async () => {
    m.buildAgentBriefing.mockResolvedValue(briefing());
    const { outcome, approvalRequestId } = await draftConversationForClient("client-1", RM, "conversation", { storeApproval: false });
    expect(outcome.status).toBe("draft");
    expect(approvalRequestId).toBeNull();
    expect(m.requestApproval).not.toHaveBeenCalled();
  });
});

describe("requestDraftApprovalForClient: an RM-reviewed text is checked again before it is stored", () => {
  it("stores a clean edited text as a pending CUSTOMER_MESSAGE_DRAFT approval at L3", async () => {
    m.buildAgentBriefing.mockResolvedValue(briefing());
    const result = await requestDraftApprovalForClient("client-1", RM, { kind: "conversation", body: "Hi Riya, following up on our chat.", source: "template", note: "edited by the RM before approval" });
    expect(result).toEqual({ status: "requested", approvalRequestId: "ar-1" });
    expect(m.requestApproval).toHaveBeenCalledWith(CUSTOMER_MESSAGE_DRAFT, expect.objectContaining({ entityId: "client-1", autonomyLevel: "L3" }), RM);
  });

  it("refuses an edit that names a blocked asset class, and stores nothing", async () => {
    m.buildAgentBriefing.mockResolvedValue(briefing({ mustNotDiscuss: ["PMS"], mustNotDiscussKeys: ["asset:PMS"] }));
    const result = await requestDraftApprovalForClient("client-1", RM, { kind: "conversation", body: "Hi Riya, your PMS is doing well.", source: "model", note: "edited by the RM before approval" });
    expect(result).toMatchObject({ status: "refused", reason: expect.stringContaining("do-not-discuss topic") });
    expect(m.requestApproval).not.toHaveBeenCalled();
  });

  it("refuses when the customer is no longer found", async () => {
    m.buildAgentBriefing.mockResolvedValue(null);
    const result = await requestDraftApprovalForClient("client-x", RM, { kind: "conversation", body: "Hi", source: "template", note: null });
    expect(result).toEqual({ status: "refused", reason: "customer not found" });
    expect(m.requestApproval).not.toHaveBeenCalled();
  });
});

describe("the only route to a send is an approved, different-person decision", () => {
  it("a stored draft cannot be sent while pending, and is sent once after another person approves it", async () => {
    m.buildAgentBriefing.mockResolvedValue(briefing());
    const stored = await requestDraftApprovalForClient("client-1", RM, { kind: "conversation", body: "Hi Riya, checking in.", source: "template", note: null });
    expect(stored.status).toBe("requested");
    const payload = m.requestApproval.mock.calls[0][1].payload as DraftPayload;
    const row = (over: Partial<ApprovalRequestRow> = {}): ApprovalRequestRow => ({
      id: "ar-1", actionType: CUSTOMER_MESSAGE_DRAFT, entity: "Client", entityId: "client-1", status: "PENDING", payload,
      requestedById: RM.id, decidedById: null, expiresAt: new Date(NOW.getTime() + 60_000), ...over,
    });
    const send = vi.fn(async () => {});
    const gates = { isSendEnabled: () => true, recheck: async () => ({ ok: true as const }), claimSend: async () => true, now: () => NOW, send };

    await expect(dispatchApprovedDraft("ar-1", { ...gates, load: async () => row() })).rejects.toThrow(/status is PENDING/);
    expect(send).not.toHaveBeenCalled();

    await expect(dispatchApprovedDraft("ar-1", { ...gates, load: async () => row({ status: "APPROVED", decidedById: RM.id }) })).rejects.toThrow(/cannot also approve/);
    expect(send).not.toHaveBeenCalled();

    await dispatchApprovedDraft("ar-1", { ...gates, load: async () => row({ status: "APPROVED", decidedById: "mgr-1" }) });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("handOverConversationForClient", () => {
  it("records an RM handover with the refusal reason as the main concern", async () => {
    m.buildAgentBriefing.mockResolvedValue(briefing({ openIssues: [{ kind: "complaint" }] }));
    const result = await handOverConversationForClient("client-1", RM, "A sales draft is blocked for this customer.");
    expect(result).toMatchObject({ status: "handed_over" });
    expect(m.recordInteractionOutcome).toHaveBeenCalledWith(expect.objectContaining({ outcome: "RM_HANDOVER", summary: expect.stringContaining("A sales draft is blocked for this customer.") }));
  });
});
