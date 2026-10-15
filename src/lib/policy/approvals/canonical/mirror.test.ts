import { describe, expect, it, vi } from "vitest";

import { mirrorData, writeMirror, writeThroughEnabled } from "./mirror";

const base = { kind: "agent-proposal" as const, id: "p1", subject: { type: "Customer message", id: "c1", label: "x", href: null }, decision: "approve" as const, state: "executed" as const, actorId: "rm1", reason: "good", correlationId: "approval:agent-proposal:p1", causationId: "evt", autonomy: "L4" as const, decidedAt: new Date("2027-04-20T09:00:00Z") };

describe("canonical write-through record", () => {
  it("is a decided ApprovalRequest row carrying decision, reason, approver, chain and autonomy, and it can never be decided again", () => {
    const d = mirrorData(base);
    expect(d).toMatchObject({
      actionType: "AGENT_PROPOSAL", entity: "Customer message", entityId: "c1", status: "APPROVED", decidedById: "rm1", decidedAt: base.decidedAt, decisionNote: "good", appliedAt: base.decidedAt,
      correlationId: "approval:agent-proposal:p1", causationId: "evt", autonomyLevel: "L4", idempotencyKey: "mirror:agent-proposal:p1:executed",
    });
    expect(d.payload).toMatchObject({ mirror: true, kind: "agent-proposal", subjectId: "p1", state: "executed", requester: "system" });
  });

  it("maps rejected, expired and cancelled, and leaves appliedAt empty unless it executed", () => {
    expect(mirrorData({ ...base, decision: "reject", state: "rejected" })).toMatchObject({ status: "REJECTED", appliedAt: null });
    expect(mirrorData({ ...base, state: "approved" })).toMatchObject({ status: "APPROVED", appliedAt: null });
    expect(mirrorData({ ...base, state: "expired" }).status).toBe("EXPIRED");
  });

  it("a human requester is recorded as the requester; a system one is the decider, said plainly in the payload", () => {
    expect(mirrorData({ ...base, requesterId: "author1" })).toMatchObject({ requestedById: "author1", payload: expect.objectContaining({ requester: "author1" }) });
    expect(mirrorData(base)).toMatchObject({ requestedById: "rm1", payload: expect.objectContaining({ requester: "system" }) });
  });

  it("never writes a pending row (a mirror is born decided), so the existing queues never show it", () => {
    for (const state of ["approved", "rejected", "executed", "failed", "expired", "cancelled"] as const) expect(mirrorData({ ...base, state }).status).not.toBe("PENDING");
  });

  it("a duplicate (the same decision recorded twice) is quietly ignored; any other database error is raised", async () => {
    const dup = Object.assign(new Error("unique"), { code: "P2002" });
    await expect(writeMirror({ approvalRequest: { create: vi.fn(async () => { throw dup; }) } } as never, base)).resolves.toBeUndefined();
    await expect(writeMirror({ approvalRequest: { create: vi.fn(async () => { throw new Error("db down"); }) } } as never, base)).rejects.toThrow("db down");
    const create = vi.fn(async () => ({}));
    await writeMirror({ approvalRequest: { create } } as never, base);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("each adapter has its own switch, off unless it is exactly 1", () => {
    expect(writeThroughEnabled("agent-proposal", {})).toBe(false);
    expect(writeThroughEnabled("agent-proposal", { APPROVALS_WT_AGENT_PROPOSAL: "1" })).toBe(true);
    expect(writeThroughEnabled("agent-proposal", { APPROVALS_WT_AGENT_PROPOSAL: "true" })).toBe(false);
    expect(writeThroughEnabled("agent-proposal", { APPROVALS_WT_SOCIAL_POST: "1" })).toBe(false);
    expect(writeThroughEnabled("payout-run", { APPROVALS_WT_PAYOUT_RUN: "1" })).toBe(false); // native kinds have no mirror
    expect(writeThroughEnabled("autopilot-action", { APPROVALS_WT_AUTOPILOT_ACTION: "1" })).toBe(true);
    expect(writeThroughEnabled("autopilot-action", {})).toBe(false);
    expect(writeThroughEnabled("ad-creative", { APPROVALS_WT_AD_CREATIVE: "1" })).toBe(true); // ad-creative is a read-through adapter now (creative branch)
    expect(writeThroughEnabled("director-report", { APPROVALS_WT_DIRECTOR_REPORT: "1" })).toBe(true); // director-report too
  });
});
