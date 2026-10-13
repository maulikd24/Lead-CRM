import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  clientFindFirst: vi.fn(),
  draftConversationForClient: vi.fn(),
  requestDraftApprovalForClient: vi.fn(),
  handOverConversationForClient: vi.fn(),
}));

vi.mock("@/lib/auth/require-role", () => ({ requireAccess: m.requireAccess }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { client: { findFirst: m.clientFindFirst } } }));
vi.mock("@/lib/ai-execution/wiring", () => ({
  draftConversationForClient: m.draftConversationForClient,
  requestDraftApprovalForClient: m.requestDraftApprovalForClient,
  handOverConversationForClient: m.handOverConversationForClient,
}));

import { draftWithAiAction, handOverToRmAction, requestDraftApprovalAction } from "./draft-actions";

/** The database filter the inbox uses: an RM sees only clients assigned to them. Mirrors clientScopeWhere. */
const CLIENTS = [
  { id: "client-mine", assignedToId: "rm-1" },
  { id: "client-other", assignedToId: "rm-2" },
];
function scopedFind(args: { where: { id: string; assignedToId?: { in: string[] } } }) {
  const c = CLIENTS.find((x) => x.id === args.where.id);
  if (!c) return null;
  if (args.where.assignedToId && !args.where.assignedToId.in.includes(c.assignedToId)) return null;
  return { id: c.id, assignedToId: c.assignedToId };
}

function signIn(role: "RM" | "MANAGER" | "ADMIN" | "AGENT", id = "rm-1") {
  m.requireAccess.mockResolvedValue({ user: { id, role } });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.clientFindFirst.mockImplementation(async (args) => scopedFind(args));
  m.draftConversationForClient.mockResolvedValue({ outcome: { status: "draft", kind: "conversation", body: "Hi Riya.", source: "template", note: null }, approvalRequestId: null });
  m.requestDraftApprovalForClient.mockResolvedValue({ status: "requested", approvalRequestId: "ar-1" });
  m.handOverConversationForClient.mockResolvedValue({ status: "handed_over", summary: { text: "", followUp: "", triggers: [] }, approvalRequestId: null });
});

describe("draftWithAiAction: the access check", () => {
  it("refuses a customer the RM does not own, and never calls the drafter", async () => {
    signIn("RM", "rm-1");
    await expect(draftWithAiAction("client-other")).rejects.toThrow("Conversation not found");
    expect(m.draftConversationForClient).not.toHaveBeenCalled();
  });

  it("lets the RM draft for their own customer, and asks for the text only (no approval stored)", async () => {
    signIn("RM", "rm-1");
    const result = await draftWithAiAction("client-mine");
    expect(result).toEqual({ status: "draft", body: "Hi Riya.", source: "template", note: null });
    expect(m.draftConversationForClient).toHaveBeenCalledWith("client-mine", { id: "rm-1", role: "RM" }, "conversation", { storeApproval: false });
  });

  it("refuses a Manager: the inbox is view-only for managers, so no draft is made", async () => {
    signIn("MANAGER", "mgr-1");
    await expect(draftWithAiAction("client-mine")).rejects.toThrow(/View-only/);
    expect(m.draftConversationForClient).not.toHaveBeenCalled();
  });

  it("refuses a role with no inbox access at all", async () => {
    signIn("AGENT", "x-1");
    await expect(draftWithAiAction("client-mine")).rejects.toThrow("Not authorized");
    expect(m.draftConversationForClient).not.toHaveBeenCalled();
  });
});

describe("draftWithAiAction: a refused draft shows a plain reason and creates no approval", () => {
  it("returns the plain sales-block message with a hand-over offer", async () => {
    signIn("RM", "rm-1");
    m.draftConversationForClient.mockResolvedValue({ outcome: { status: "refused", reason: "sales topics are set aside for this customer" }, approvalRequestId: null });
    const result = await draftWithAiAction("client-mine");
    expect(result).toEqual({
      status: "refused",
      message: "A sales draft is blocked for this customer: sales topics are set aside on their record.",
      canHandOver: true,
    });
    expect(m.requestDraftApprovalForClient).not.toHaveBeenCalled();
  });
});

describe("requestDraftApprovalAction: Send for approval stores, it never sends", () => {
  it("passes the RM's text to the approval gate, marked as edited", async () => {
    signIn("RM", "rm-1");
    const result = await requestDraftApprovalAction("client-mine", "Hi Riya, edited.", true, "model");
    expect(result).toEqual({ status: "requested", approvalRequestId: "ar-1" });
    expect(m.requestDraftApprovalForClient).toHaveBeenCalledWith("client-mine", { id: "rm-1", role: "RM" }, { kind: "conversation", body: "Hi Riya, edited.", source: "model", note: "edited by the RM before approval" });
  });

  it("refuses a customer the RM does not own, and stores nothing", async () => {
    signIn("RM", "rm-1");
    await expect(requestDraftApprovalAction("client-other", "Hi", false, "template")).rejects.toThrow("Conversation not found");
    expect(m.requestDraftApprovalForClient).not.toHaveBeenCalled();
  });

  it("returns a plain refusal, not an approval, when the edited text fails the checks", async () => {
    signIn("RM", "rm-1");
    m.requestDraftApprovalForClient.mockResolvedValue({ status: "refused", reason: "uses a do-not-discuss topic (PMS)" });
    const result = await requestDraftApprovalAction("client-mine", "Hi, your PMS...", true, "model");
    expect(result).toMatchObject({ status: "refused", canHandOver: true });
  });
});

describe("handOverToRmAction", () => {
  it("hands over the conversation for an RM who owns it", async () => {
    signIn("RM", "rm-1");
    await expect(handOverToRmAction("client-mine", "A sales draft is blocked.")).resolves.toEqual({ status: "handed_over" });
    expect(m.handOverConversationForClient).toHaveBeenCalledWith("client-mine", { id: "rm-1", role: "RM" }, "A sales draft is blocked.");
  });

  it("refuses to hand over a customer the RM does not own", async () => {
    signIn("RM", "rm-1");
    await expect(handOverToRmAction("client-other", "x")).rejects.toThrow("Conversation not found");
    expect(m.handOverConversationForClient).not.toHaveBeenCalled();
  });
});
