import { describe, expect, it, vi } from "vitest";

import { assertMayExecute, assertWithinCeiling, ACTION_TYPES } from "@/lib/agents/autonomy";

import { CUSTOMER_MESSAGE_DRAFT, DraftNotApprovedError, DRAFT_TTL_MS, dispatchApprovedDraft, requestDraftApproval, type ApprovalRequestRow, type DraftPayload } from "./approval";

const NOW = new Date("2026-10-13T10:00:00Z");
const future = new Date(NOW.getTime() + 60_000);
const payload: DraftPayload = { clientId: "client-1", channel: "whatsapp", kind: "conversation", body: "Hi Riya, checking in on your account.", source: "template", note: null };

const approved = (over: Partial<ApprovalRequestRow> = {}): ApprovalRequestRow => ({
  id: "ar-1", actionType: CUSTOMER_MESSAGE_DRAFT, entity: "Client", entityId: "client-1", status: "APPROVED", payload,
  requestedById: "rm-1", decidedById: "mgr-1", expiresAt: future, ...over,
});

describe("guardrail: a draft can never reach a send function without an approved ApprovalRequest", () => {
  const cases: [string, ApprovalRequestRow | null, RegExp][] = [
    ["no approval request exists", null, /no such approval request/],
    ["the request is of another type", approved({ actionType: "STAGE_OVERRIDE" }), /not a customer message draft/],
    ["the request is still pending", approved({ status: "PENDING", decidedById: null }), /status is PENDING/],
    ["the request was rejected", approved({ status: "REJECTED" }), /status is REJECTED/],
    ["the request expired", approved({ status: "EXPIRED" }), /status is EXPIRED/],
    ["approved but with no decider on record", approved({ decidedById: null }), /no decision on record/],
    ["the requester approved their own draft", approved({ decidedById: "rm-1" }), /cannot also approve their own/],
    ["the approval window has passed", approved({ expiresAt: new Date(NOW.getTime() - 1) }), /has expired/],
    ["the stored payload is malformed", approved({ payload: { clientId: "client-1", body: "" } }), /malformed/],
    ["the draft names a different customer", approved({ payload: { ...payload, clientId: "client-2" } }), /different customers/],
  ];

  it.each(cases)("refuses and does not send when %s", async (_name, row, reason) => {
    const send = vi.fn(async () => {});
    await expect(dispatchApprovedDraft("ar-1", { load: async () => row, now: () => NOW, send })).rejects.toThrow(DraftNotApprovedError);
    await expect(dispatchApprovedDraft("ar-1", { load: async () => row, now: () => NOW, send })).rejects.toThrow(reason);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends exactly once, with the approved payload, when everything checks out", async () => {
    const send = vi.fn(async () => {});
    await dispatchApprovedDraft("ar-1", { load: async () => approved(), now: () => NOW, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(payload, "ar-1");
  });
});

describe("guardrail: the autonomy ladder keeps customer messages at L4 at most, never L5", () => {
  it("draft_customer_message is a customer send with a ceiling of L4", () => {
    expect(ACTION_TYPES.draft_customer_message.class).toBe("customer_send");
    expect(() => assertWithinCeiling("draft_customer_message", 4)).not.toThrow();
  });
  it("L5 (auto-execute) is refused for a customer message", () => {
    expect(() => assertWithinCeiling("draft_customer_message", 5)).toThrow(/ceiling is L4/);
  });
  it("execution below L4 is refused: a draft is never sent at L3", () => {
    expect(() => assertMayExecute({ actionType: "draft_customer_message", level: 3, approvalRef: "ar-1" })).toThrow(/may draft or advise, not execute/);
  });
  it("execution at L4 without an approval reference is refused", () => {
    expect(() => assertMayExecute({ actionType: "draft_customer_message", level: 4, approvalRef: null })).toThrow(/human approval reference/);
  });
});

describe("a draft is stored as an ApprovalRequest and nothing is sent", () => {
  it("requests approval for a CUSTOMER_MESSAGE_DRAFT with the draft text, an L3 level and a 24 hour window", async () => {
    const requestApproval = vi.fn(async () => ({ id: "ar-9" }));
    const out = await requestDraftApproval(
      { clientId: "client-1", kind: "conversation", body: payload.body, source: "template", note: null, correlationId: "corr-1" },
      { id: "rm-1", role: "RM" },
      { requestApproval, now: () => NOW },
    );
    expect(out).toEqual({ approvalRequestId: "ar-9" });
    const [type, input, actor] = requestApproval.mock.calls[0] as unknown as [string, { payload: DraftPayload; expiresAt: Date; autonomyLevel: string; entityId: string; correlationId: string }, { id: string }];
    expect(type).toBe(CUSTOMER_MESSAGE_DRAFT);
    expect(input.payload.body).toBe(payload.body);
    expect(input.entityId).toBe("client-1");
    expect(input.autonomyLevel).toBe("L3");
    expect(input.correlationId).toBe("corr-1");
    expect(input.expiresAt.getTime()).toBe(NOW.getTime() + DRAFT_TTL_MS);
    expect(actor).toEqual({ id: "rm-1", role: "RM" });
  });
});
