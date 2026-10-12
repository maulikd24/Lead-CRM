import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  clientFindFirst: vi.fn(), proposalFindMany: vi.fn(), proposalFindFirst: vi.fn(),
  enabled: vi.fn(), messages: vi.fn(), transition: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { client: { findFirst: m.clientFindFirst }, agentProposal: { findMany: m.proposalFindMany, findFirst: m.proposalFindFirst } } }));
vi.mock("./wiring", () => ({ isAgentEnabled: m.enabled, loadConversationMessages: m.messages, transitionProposal: m.transition, replyAssistDeps: vi.fn(), decideDeps: vi.fn() }));

import { dismissSuggestion, getAssistState } from "./reply-assist-service";

const RM1 = { id: "rm1", role: "RM" } as const;
const RM2 = { id: "rm2", role: "RM" } as const;
const MGR = { id: "mg", role: "MANAGER" } as const;
const ADMIN = { id: "ad", role: "ADMIN" } as const;
const T = (min: number) => new Date(Date.UTC(2026, 9, 9, 10, min));

// The fixtures are dated: pin the clock so the staleness rules are judged against them, not against today.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T(10));
  Object.values(m).forEach((f) => f.mockReset());
  m.enabled.mockResolvedValue(true);
  m.clientFindFirst.mockResolvedValue({ assignedToId: "rm1" });
  m.messages.mockResolvedValue([{ direction: "OUTBOUND", body: "hi", at: T(0) }, { direction: "INBOUND", body: "kya hua?", at: T(5) }]);
  m.proposalFindMany.mockResolvedValue([]);
  m.transition.mockResolvedValue(true);
});

afterEach(() => vi.useRealTimers());

describe("getAssistState authorization", () => {
  it("is off for a manager (view-only)", async () => expect((await getAssistState(MGR, "c1")).enabled).toBe(false));
  it("is off for an RM on someone else's client", async () => expect((await getAssistState(RM2, "c1")).enabled).toBe(false));
  it("is on for the assigned RM and for an admin", async () => {
    expect((await getAssistState(RM1, "c1")).enabled).toBe(true);
    expect((await getAssistState(ADMIN, "c1")).enabled).toBe(true);
  });
  it("is off when the flag is off, without touching the database", async () => {
    m.enabled.mockResolvedValue(false);
    expect((await getAssistState(RM1, "c1")).enabled).toBe(false);
    expect(m.clientFindFirst).not.toHaveBeenCalled();
  });
  it("is off for a missing client", async () => {
    m.clientFindFirst.mockResolvedValue(null);
    expect((await getAssistState(ADMIN, "c1")).enabled).toBe(false);
  });
});

describe("getAssistState staleness", () => {
  it("expires a DRAFT made before the customer's latest message (compare-and-set) and hides it", async () => {
    m.proposalFindMany.mockResolvedValue([{ id: "old", status: "DRAFT", body: "b", originalBody: "b", reason: "kyc_pending", blockedReason: null, createdAt: T(2), expiresAt: T(2000), inputTokens: 0, outputTokens: 0 }]);
    const s = await getAssistState(RM1, "c1");
    expect(m.transition).toHaveBeenCalledWith("old", "DRAFT", "EXPIRED");
    expect(s.view).toEqual({ kind: "none" });
  });
  it("shows a current draft and does not expire it", async () => {
    m.proposalFindMany.mockResolvedValue([{ id: "cur", status: "DRAFT", body: "b", originalBody: "b", reason: "kyc_pending", blockedReason: null, createdAt: T(6), expiresAt: T(2000), inputTokens: 0, outputTokens: 0 }]);
    const s = await getAssistState(RM1, "c1");
    expect(m.transition).not.toHaveBeenCalled();
    expect(s.view).toMatchObject({ kind: "draft", id: "cur" });
  });
});

describe("dismissSuggestion", () => {
  it("refuses an id that is not this client's wa_reply proposal (own scoped lookup, no transition)", async () => {
    m.proposalFindFirst.mockResolvedValue(null);
    await dismissSuggestion(RM1, "c1", "someone-elses");
    expect(m.proposalFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "someone-elses", clientId: "c1", agentKey: "wa_reply" } }));
    expect(m.transition).not.toHaveBeenCalled();
  });
  it("refuses when the caller may not act on the client", async () => {
    await dismissSuggestion(RM2, "c1", "p1");
    expect(m.proposalFindFirst).not.toHaveBeenCalled();
    expect(m.transition).not.toHaveBeenCalled();
  });
  it("dismisses its own draft with its own compare-and-set (DRAFT -> REJECTED, who and when)", async () => {
    m.proposalFindFirst.mockResolvedValue({ id: "p1" });
    await dismissSuggestion(RM1, "c1", "p1");
    expect(m.transition).toHaveBeenCalledWith("p1", "DRAFT", "REJECTED", expect.objectContaining({ decidedById: "rm1", decidedAt: expect.any(Date) }));
  });
});
