import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  clientFindFirst: vi.fn(), proposalFindMany: vi.fn(), proposalFindFirst: vi.fn(),
  enabled: vi.fn(), messages: vi.fn(), transition: vi.fn(), pilot: vi.fn(), pilotProvider: vi.fn(), replyDeps: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: { client: { findFirst: m.clientFindFirst }, agentProposal: { findMany: m.proposalFindMany, findFirst: m.proposalFindFirst } } }));
vi.mock("./wiring", () => ({ isAgentEnabled: m.enabled, loadConversationMessages: m.messages, transitionProposal: m.transition, replyAssistDeps: m.replyDeps, decideDeps: vi.fn() }));
vi.mock("./pilot-wiring", () => ({ pilotAccessFor: m.pilot, pilotProvider: m.pilotProvider }));

import { dismissSuggestion, getAssistState, runSuggestion } from "./reply-assist-service";

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
  m.pilot.mockResolvedValue({ allowed: true });
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

describe("the pilot allowlist sits on top of the flag and the permission check", () => {
  it("hides the panel from someone who is not on the list, before looking at the customer", async () => {
    m.pilot.mockResolvedValue({ allowed: false, reason: "not_in_pilot" });
    const s = await getAssistState(RM1, "c1");
    expect(s).toEqual({ enabled: false, auto: false, view: { kind: "none" } });
    expect(m.pilot).toHaveBeenCalledWith("rm1");
    expect(m.clientFindFirst).not.toHaveBeenCalled();
    expect(m.messages).not.toHaveBeenCalled();
  });
  it("hides it for an Admin who is not listed too: the list has no exceptions", async () => {
    m.pilot.mockResolvedValue({ allowed: false, reason: "not_in_pilot" });
    expect((await getAssistState(ADMIN, "c1")).enabled).toBe(false);
  });
  it("hides it while a prerequisite (key, sign-off) is missing", async () => {
    for (const reason of ["no_ai_key", "no_signoff", "agent_off"] as const) {
      m.pilot.mockResolvedValue({ allowed: false, reason });
      expect((await getAssistState(RM1, "c1")).enabled).toBe(false);
    }
  });
  it("shows it for a listed, permitted user", async () => {
    expect((await getAssistState(RM1, "c1")).enabled).toBe(true);
  });
  it("does not ask the pilot at all when the agent flag is off", async () => {
    m.enabled.mockResolvedValue(false);
    await getAssistState(RM1, "c1");
    expect(m.pilot).not.toHaveBeenCalled();
  });
  it("a request to draft from a user outside the pilot builds no provider, calls no model and reads no messages", async () => {
    m.pilot.mockResolvedValue({ allowed: false, reason: "not_in_pilot" });
    const s = await runSuggestion(RM1, "c1", {});
    expect(s.enabled).toBe(false);
    expect(m.pilotProvider).not.toHaveBeenCalled();
    expect(m.replyDeps).not.toHaveBeenCalled();
    expect(m.messages).not.toHaveBeenCalled();
  });
  it("an auto-draft request from a user outside the pilot is refused the same way", async () => {
    m.pilot.mockResolvedValue({ allowed: false, reason: "not_in_pilot" });
    expect((await runSuggestion(RM1, "c1", { auto: true })).enabled).toBe(false);
    expect(m.replyDeps).not.toHaveBeenCalled();
  });
  it("a listed user's request uses the provider built from the key an Admin saved in Settings, not an environment key", async () => {
    const provider = { name: "anthropic", complete: vi.fn() };
    m.pilotProvider.mockResolvedValue(provider);
    m.replyDeps.mockImplementation(() => { throw new Error("stop here: only checking which provider was handed over"); });
    await runSuggestion(RM1, "c1", {});
    expect(m.replyDeps).toHaveBeenCalledWith(provider);
  });
  it("if the saved key cannot be read, nothing is drafted and the user is told to try later", async () => {
    m.pilotProvider.mockResolvedValue(null);
    const s = await runSuggestion(RM1, "c1", {});
    expect(m.replyDeps).not.toHaveBeenCalled();
    expect(s.message).toMatch(/not available|try again/i);
  });
});
