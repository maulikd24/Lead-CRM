import { describe, expect, it, vi } from "vitest";

import { assertMayExecute, assertWithinCeiling, ACTION_TYPES } from "@/lib/agents/autonomy";

import { CUSTOMER_MESSAGE_DRAFT, DraftNotApprovedError, DRAFT_TTL_MS, dispatchApprovedDraft, recheckAgainst, requestDraftApproval, sendEnabledFromEnv, type ApprovalRequestRow, type DispatchDeps, type DraftPayload } from "./approval";
import type { DraftContext } from "./draft";

const NOW = new Date("2026-10-13T10:00:00Z");
const future = new Date(NOW.getTime() + 60_000);
const payload: DraftPayload = { clientId: "client-1", channel: "whatsapp", kind: "conversation", body: "Hi Riya, checking in on your account.", source: "template", note: null };

const approved = (over: Partial<ApprovalRequestRow> = {}): ApprovalRequestRow => ({
  id: "ar-1", actionType: CUSTOMER_MESSAGE_DRAFT, entity: "Client", entityId: "client-1", status: "APPROVED", payload,
  requestedById: "rm-1", decidedById: "mgr-1", expiresAt: future, ...over,
});

/** Gates that all pass: kill switch off, the recheck clean, nothing sent yet. Each test overrides one. */
function gates(over: Partial<Pick<DispatchDeps, "isSendEnabled" | "recheck" | "claimSend">> = {}): Pick<DispatchDeps, "isSendEnabled" | "recheck" | "claimSend"> {
  return { isSendEnabled: () => true, recheck: async () => ({ ok: true }), claimSend: async () => true, ...over };
}

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
    await expect(dispatchApprovedDraft("ar-1", { ...gates(), load: async () => row, now: () => NOW, send })).rejects.toThrow(DraftNotApprovedError);
    await expect(dispatchApprovedDraft("ar-1", { ...gates(), load: async () => row, now: () => NOW, send })).rejects.toThrow(reason);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends exactly once, with the approved payload, when everything checks out", async () => {
    const send = vi.fn(async () => {});
    await dispatchApprovedDraft("ar-1", { ...gates(), load: async () => approved(), now: () => NOW, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(payload, "ar-1");
  });
});

describe("send-time gates: the kill switch, the recheck and the sent-once marker", () => {
  it("sends nothing while AI_KILL_SWITCH is on, even for an approved draft", async () => {
    const send = vi.fn(async () => {});
    const enabled = sendEnabledFromEnv({ AI_KILL_SWITCH: "1" });
    await expect(dispatchApprovedDraft("ar-1", { ...gates(), isSendEnabled: () => enabled, load: async () => approved(), now: () => NOW, send })).rejects.toThrow(/AI kill switch/);
    expect(send).not.toHaveBeenCalled();
  });
  it("the kill switch helper reads AI_KILL_SWITCH=1 as off", () => {
    expect(sendEnabledFromEnv({ AI_KILL_SWITCH: "1" })).toBe(false);
    expect(sendEnabledFromEnv({ AI_KILL_SWITCH: "0" })).toBe(true);
    expect(sendEnabledFromEnv({})).toBe(true);
  });
  it("sends nothing when the draft fails its checks at send time (the customer changed since)", async () => {
    const send = vi.fn(async () => {});
    const recheck = vi.fn(async () => ({ ok: false as const, reason: "uses a do-not-discuss topic (PMS)" }));
    await expect(dispatchApprovedDraft("ar-1", { ...gates({ recheck }), load: async () => approved(), now: () => NOW, send })).rejects.toThrow(/fails its checks now: uses a do-not-discuss topic/);
    expect(recheck).toHaveBeenCalledWith(payload);
    expect(send).not.toHaveBeenCalled();
  });
  it("the recheck uses the customer's current context: a PMS block added after drafting stops the send", async () => {
    const current: DraftContext = { clientId: "client-1", firstName: "Riya", language: "English", kind: "conversation", acceptance: [], lastInteraction: null, pendingCommitments: 0, blockedAssetClasses: ["PMS"], blockedTopics: [], openIssueKinds: [] };
    const pms = { ...payload, body: "Hi Riya, a PMS could be a fit for you." };
    const send = vi.fn(async () => {});
    await expect(dispatchApprovedDraft("ar-1", { ...gates({ recheck: recheckAgainst(async () => current) }), load: async () => approved({ payload: pms }), now: () => NOW, send })).rejects.toThrow(/fails its checks now/);
    expect(send).not.toHaveBeenCalled();
  });
  it("sends nothing when the customer's context can no longer be loaded (fail closed)", async () => {
    const send = vi.fn(async () => {});
    await expect(dispatchApprovedDraft("ar-1", { ...gates({ recheck: recheckAgainst(async () => null) }), load: async () => approved(), now: () => NOW, send })).rejects.toThrow(/no longer available/);
    expect(send).not.toHaveBeenCalled();
  });
  it("a second dispatch of the same approved row sends nothing (sent-once marker)", async () => {
    const sent = new Set<string>();
    const claimSend = async (id: string) => {
      if (sent.has(id)) return false;
      sent.add(id);
      return true;
    };
    const send = vi.fn(async () => {});
    const deps = { ...gates({ claimSend }), load: async () => approved(), now: () => NOW, send };
    await dispatchApprovedDraft("ar-1", deps);
    await expect(dispatchApprovedDraft("ar-1", deps)).rejects.toThrow(/already sent/);
    expect(send).toHaveBeenCalledTimes(1);
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
  it("execution at L4 with a reference that is not APPROVED is refused", () => {
    expect(() => assertMayExecute({ actionType: "draft_customer_message", level: 4, approvalRef: "ar-1", approvalStatus: "PENDING" })).toThrow(/not APPROVED/);
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
