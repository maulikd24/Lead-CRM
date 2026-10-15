import { describe, expect, it, vi } from "vitest";

import { DraftNotApprovedError } from "@/lib/ai-execution/approval";
import type { Actor } from "@/lib/policy/types";

import { dispatchApprovedReply, FRESHDESK_REPLY_DRAFT, requestReplyApproval, type DispatchDeps, type ReplyApprovalRow, type ReplyPayload } from "./send";
import { NOW } from "./test-fixtures";

const payload: ReplyPayload = { clientId: "client-1", ticketId: "4521", kind: "service_response", body: "Hi Asha, we are on it.", source: "template", note: null };
const approver: Actor = { id: "mgr-2", role: "MANAGER" };
const requester = "mgr-1";

function row(over: Partial<ReplyApprovalRow> = {}): ReplyApprovalRow {
  return { id: "appr-1", actionType: FRESHDESK_REPLY_DRAFT, entity: "Client", entityId: "client-1", status: "APPROVED", payload, requestedById: requester, decidedById: approver.id, expiresAt: new Date(NOW.getTime() + 3_600_000), appliedAt: null, ...over };
}

function deps(over: Partial<DispatchDeps> = {}) {
  const send = vi.fn(async () => ({ ok: true as const, replyId: "r-9" }));
  const releaseClaim = vi.fn(async () => {});
  const base: DispatchDeps = {
    load: vi.fn(async () => row()),
    now: () => NOW,
    isSendEnabled: () => true,
    recheck: vi.fn(async () => ({ ok: true as const })),
    claimSend: vi.fn(async () => true),
    releaseClaim,
    send,
  };
  return { d: { ...base, ...over } as DispatchDeps, send, releaseClaim };
}

describe("no send without an approved decision", () => {
  it("a reply that is still pending is never sent", async () => {
    const { d, send } = deps({ load: async () => row({ status: "PENDING", decidedById: null }) });
    await expect(dispatchApprovedReply("appr-1", approver, d)).rejects.toBeInstanceOf(DraftNotApprovedError);
    expect(send).not.toHaveBeenCalled();
  });

  it("a rejected reply is never sent", async () => {
    const { d, send } = deps({ load: async () => row({ status: "REJECTED" }) });
    await expect(dispatchApprovedReply("appr-1", approver, d)).rejects.toThrow(/REJECTED/);
    expect(send).not.toHaveBeenCalled();
  });

  it("the requester cannot approve and send their own reply", async () => {
    const { d, send } = deps({ load: async () => row({ decidedById: requester }) });
    await expect(dispatchApprovedReply("appr-1", { id: requester, role: "MANAGER" }, d)).rejects.toThrow(/own reply/);
    expect(send).not.toHaveBeenCalled();
  });

  it("only the approver sends: someone else cannot push an approved reply out", async () => {
    const { d, send } = deps();
    await expect(dispatchApprovedReply("appr-1", { id: "admin-7", role: "ADMIN" }, d)).rejects.toThrow(/only the person who approved/);
    expect(send).not.toHaveBeenCalled();
  });

  it("an expired approval is not sent", async () => {
    const { d, send } = deps({ load: async () => row({ expiresAt: new Date(NOW.getTime() - 1) }) });
    await expect(dispatchApprovedReply("appr-1", approver, d)).rejects.toThrow(/expired/);
    expect(send).not.toHaveBeenCalled();
  });

  it("the AI kill switch stops the send", async () => {
    const { d, send } = deps({ isSendEnabled: () => false });
    await expect(dispatchApprovedReply("appr-1", approver, d)).rejects.toThrow(/AI_KILL_SWITCH/);
    expect(send).not.toHaveBeenCalled();
  });

  it("a reply that fails the checks against the ticket as it is now is not sent", async () => {
    const { d, send } = deps({ recheck: async () => ({ ok: false as const, reason: "the ticket is closed" }) });
    await expect(dispatchApprovedReply("appr-1", approver, d)).rejects.toThrow(/the ticket is closed/);
    expect(send).not.toHaveBeenCalled();
  });

  it("a reply that was already sent is not sent again", async () => {
    const { d, send } = deps({ load: async () => row({ appliedAt: NOW }) });
    await expect(dispatchApprovedReply("appr-1", approver, d)).rejects.toThrow(/already sent/);
    expect(send).not.toHaveBeenCalled();
  });

  it("a second dispatch that loses the claim sends nothing", async () => {
    const { d, send } = deps({ claimSend: async () => false });
    await expect(dispatchApprovedReply("appr-1", approver, d)).rejects.toThrow(/already sent/);
    expect(send).not.toHaveBeenCalled();
  });

  it("another kind of approval, or a malformed reply, is refused", async () => {
    const wrong = deps({ load: async () => row({ actionType: "CUSTOMER_MESSAGE_DRAFT" }) });
    await expect(dispatchApprovedReply("appr-1", approver, wrong.d)).rejects.toThrow(/not a Freshdesk reply/);
    const bad = deps({ load: async () => row({ payload: { clientId: "client-1" } }) });
    await expect(dispatchApprovedReply("appr-1", approver, bad.d)).rejects.toThrow(/malformed/);
  });
});

describe("an approved reply is sent once, and only then", () => {
  it("sends the approved reply and records it", async () => {
    const { d, send } = deps();
    const out = await dispatchApprovedReply("appr-1", approver, d);
    expect(out).toEqual({ status: "sent", replyId: "r-9" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(payload);
  });

  it("a Freshdesk refusal releases the claim, so nothing is recorded as sent", async () => {
    const { d, releaseClaim } = deps({ send: async () => ({ ok: false as const, error: "Freshdesk responded 500" }) });
    await expect(dispatchApprovedReply("appr-1", approver, d)).rejects.toThrow(/did not accept/);
    expect(releaseClaim).toHaveBeenCalledWith("appr-1");
  });

  it("a thrown send error releases the claim too", async () => {
    const { d, releaseClaim } = deps({ send: async () => { throw new Error("network"); } });
    await expect(dispatchApprovedReply("appr-1", approver, d)).rejects.toThrow(/nothing was recorded as sent/);
    expect(releaseClaim).toHaveBeenCalledWith("appr-1");
  });
});

describe("requesting an approval stores a draft and sends nothing", () => {
  it("stores the reply as FRESHDESK_REPLY_DRAFT with a 24-hour expiry", async () => {
    const requestApproval = vi.fn(async () => ({ id: "appr-7" }));
    const out = await requestReplyApproval({ clientId: "client-1", ticketId: "4521", body: payload.body, source: "template", note: null }, { id: requester, role: "MANAGER" }, { requestApproval, now: () => NOW });
    expect(out).toEqual({ approvalRequestId: "appr-7" });
    const [type, input] = requestApproval.mock.calls[0] as unknown as [string, { entity: string; entityId: string; payload: ReplyPayload; expiresAt: Date }];
    expect(type).toBe(FRESHDESK_REPLY_DRAFT);
    expect(input.entity).toBe("Client");
    expect(input.entityId).toBe("client-1");
    expect(input.payload.kind).toBe("service_response");
    expect(input.expiresAt.getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
