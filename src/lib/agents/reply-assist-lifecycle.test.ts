import { describe, expect, it } from "vitest";
import { deriveAssistView, recordSuggestionSent, usageOf, type AssistRow, type SentDeps } from "./reply-assist-lifecycle";
import type { ProposalStatus } from "./proposal-state";

const now = new Date("2026-10-09T12:00:00Z");
const min = (n: number) => new Date(now.getTime() + n * 60_000);
const row = (over: Partial<AssistRow> = {}): AssistRow => ({ id: "p1", status: "DRAFT", body: "hello", originalBody: "hello", reason: "kyc_pending", blockedReason: null, createdAt: min(-5), expiresAt: min(600), inputTokens: 10, outputTokens: 5, ...over });

describe("deriveAssistView", () => {
  it("is none when there is no unanswered message", () => {
    expect(deriveAssistView({ rows: [row()], lastInboundAt: min(-10), unanswered: false, now })).toEqual({ kind: "none" });
  });
  it("is none when no row is newer than the last inbound message", () => {
    expect(deriveAssistView({ rows: [row({ createdAt: min(-20) })], lastInboundAt: min(-10), unanswered: true, now })).toEqual({ kind: "none" });
  });
  it("shows the current unexpired draft", () => {
    expect(deriveAssistView({ rows: [row()], lastInboundAt: min(-10), unanswered: true, now })).toMatchObject({ kind: "draft", id: "p1", body: "hello", reason: "kyc_pending" });
  });
  it("ignores an expired draft", () => {
    expect(deriveAssistView({ rows: [row({ expiresAt: min(-1) })], lastInboundAt: min(-10), unanswered: true, now })).toEqual({ kind: "none" });
  });
  it("shows a safety block without exposing the model text", () => {
    const v = deriveAssistView({ rows: [row({ status: "BLOCKED", blockedReason: "JUDGE: unsafe", body: "secret draft" })], lastInboundAt: min(-10), unanswered: true, now });
    expect(v).toMatchObject({ kind: "blocked", id: "p1" });
    expect(JSON.stringify(v)).not.toContain("secret draft");
  });
  it("shows the handover banner", () => {
    expect(deriveAssistView({ rows: [row({ status: "BLOCKED", blockedReason: "HANDOVER: customer mentioned \"fraud\"", body: "" })], lastInboundAt: min(-10), unanswered: true, now })).toMatchObject({ kind: "needs_human", id: "p1" });
  });
  it("a handover row stays visible after later customer messages, until the RM replies", () => {
    const h = row({ status: "BLOCKED", blockedReason: "HANDOVER: x", body: "", createdAt: min(-8) });
    expect(deriveAssistView({ rows: [h], lastInboundAt: min(-2), lastOutboundAt: min(-20), unanswered: true, now })).toMatchObject({ kind: "needs_human", id: "p1" });
    expect(deriveAssistView({ rows: [h], lastInboundAt: min(-2), lastOutboundAt: min(-5), unanswered: true, now })).toEqual({ kind: "none" });
  });
  it("uses the newest current row", () => {
    const v = deriveAssistView({ rows: [row({ id: "new", body: "n" }), row({ id: "older", createdAt: min(-6) })], lastInboundAt: min(-10), unanswered: true, now });
    expect(v).toMatchObject({ id: "new" });
  });
});

describe("usageOf", () => {
  const u = (status: ProposalStatus, body = "a", originalBody = "a", blockedReason: string | null = null) => usageOf({ status, body, originalBody, blockedReason });
  it("classifies outcomes from existing columns", () => {
    expect(u("SENT")).toBe("USED_AS_IS");
    expect(u("SENT", "a b", "a")).toBe("EDITED");
    expect(u("REJECTED")).toBe("DISMISSED");
    expect(u("EXPIRED")).toBe("EXPIRED");
    expect(u("DRAFT")).toBe("PENDING");
    expect(u("BLOCKED", "", "", "HANDOVER: x")).toBe("HANDOVER");
    expect(u("BLOCKED", "x", "x", "JUDGE: y")).toBe("BLOCKED");
  });
});

describe("recordSuggestionSent", () => {
  function deps(status: ProposalStatus = "DRAFT", over: Partial<{ agentKey: string; clientId: string }> = {}) {
    const calls: unknown[][] = [];
    const d: SentDeps = {
      load: async () => ({ id: "p1", agentKey: over.agentKey ?? "wa_reply", clientId: over.clientId ?? "c1", status }),
      transition: async (...a) => { calls.push(a); return true; },
      now: () => now,
    };
    return { d, calls };
  }
  it("walks DRAFT -> APPROVED -> SENT recording who, when, the final text and the message id", async () => {
    const { d, calls } = deps();
    expect(await recordSuggestionSent(d, { proposalId: "p1", clientId: "c1", userId: "u1", finalBody: "final", messageId: "m1" })).toBe(true);
    expect(calls[0]).toEqual(["p1", "DRAFT", "APPROVED", { decidedById: "u1", decidedAt: now, body: "final" }]);
    expect(calls[1]).toEqual(["p1", "APPROVED", "SENT", { messageId: "m1" }]);
  });
  it("does nothing for another conversation's or another agent's proposal", async () => {
    for (const d of [deps("DRAFT", { clientId: "other" }), deps("DRAFT", { agentKey: "wa_nudger" })]) {
      expect(await recordSuggestionSent(d.d, { proposalId: "p1", clientId: "c1", userId: "u1", finalBody: "x", messageId: "m1" })).toBe(false);
      expect(d.calls).toHaveLength(0);
    }
  });
  it("does nothing when the suggestion is no longer a draft (superseded/dismissed)", async () => {
    const { d, calls } = deps("EXPIRED");
    expect(await recordSuggestionSent(d, { proposalId: "p1", clientId: "c1", userId: "u1", finalBody: "x", messageId: "m1" })).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("loses the compare-and-set quietly", async () => {
    const { d } = deps();
    d.transition = async () => false;
    expect(await recordSuggestionSent(d, { proposalId: "p1", clientId: "c1", userId: "u1", finalBody: "x", messageId: "m1" })).toBe(false);
  });
});
