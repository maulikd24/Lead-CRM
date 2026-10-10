import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, form, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const db = vi.hoisted(() => ({
  activity: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  conversationReview: { update: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
const createTask = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stage-engine/create-task-if-not-exists", () => ({ createTaskIfNotExists: createTask }));

import { createFollowUpTaskAction, markCallReviewedAction } from "./actions";

/** A call owned by the "rm-1" scope, analysed, optionally already reviewed. */
function callRow(over: { rmId?: string | null; reviewedAt?: Date | null; status?: string } = {}) {
  return {
    id: "call-1",
    userId: "rm-1",
    client: { id: "client-1", name: "Riya Shah", assignedToId: "rm-1" },
    conversationReview: {
      id: "review-1",
      taskId: null,
      assignedRmId: over.rmId === undefined ? "rm-1" : over.rmId,
      recommendationText: "Share the lock-in explainer",
      status: over.status ?? "ANALYZED",
      reviewedAt: over.reviewedAt ?? null,
      reviewedById: over.reviewedAt ? "mgr-0" : null,
      reviewNotes: null,
    },
  };
}

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CALLS_REVIEW", "1");
  db.activity.findFirst.mockResolvedValue(callRow());
  db.user.findMany.mockResolvedValue([]);
  db.conversationReview.update.mockResolvedValue({});
  db.auditLog.create.mockResolvedValue({});
  createTask.mockResolvedValue({ id: "task-1" });
});

describe("call actions: who can run them", () => {
  it.each([
    ["markCallReviewedAction", () => markCallReviewedAction(form({ activityId: "call-1" }))],
    ["createFollowUpTaskAction", () => createFollowUpTaskAction(form({ activityId: "call-1" }))],
  ])("%s sends a signed-out visitor to /login and touches nothing", async (_n, run) => {
    asAnonymous();
    expect(await outcomeOf(run)).toEqual({ kind: "redirect", url: "/login" });
    expect(db.activity.findFirst).not.toHaveBeenCalled();
    expect(db.conversationReview.update).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });

  it.each(["DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER", "FINANCE"] as const)("bounces the %s role before any lookup", async (role) => {
    asUser({ role });
    const r = await outcomeOf(() => markCallReviewedAction(form({ activityId: "call-1" })));
    expect(r.kind).toBe("redirect");
    expect(db.activity.findFirst).not.toHaveBeenCalled();
  });

  it("sends a user who must change their password to /change-password", async () => {
    asUser({ role: "MANAGER", mustChangePassword: true });
    expect(await outcomeOf(() => markCallReviewedAction(form({ activityId: "call-1" })))).toEqual({ kind: "redirect", url: "/change-password" });
  });

  it("refuses everything while the flag is off, even for an admin", async () => {
    vi.stubEnv("NEXT_PUBLIC_CALLS_REVIEW", "");
    asUser({ role: "ADMIN" });
    const r = await outcomeOf(() => markCallReviewedAction(form({ activityId: "call-1" })));
    expect(r).toEqual({ kind: "returned", value: { ok: false, error: "Call review is not enabled." } });
    expect(db.activity.findFirst).not.toHaveBeenCalled();
  });
});

describe("call actions: visibility", () => {
  it("answers 'not found' (not 'forbidden') for a call outside the RM's scope", async () => {
    asUser({ id: "rm-2", role: "RM" });
    const r = await outcomeOf(() => createFollowUpTaskAction(form({ activityId: "call-1" })));
    expect(r).toEqual({ kind: "returned", value: { ok: false, error: "Call not found." } });
    expect(createTask).not.toHaveBeenCalled();
  });

  it("lets a manager act on a direct report's call, but not on someone else's", async () => {
    db.user.findMany.mockResolvedValue([{ id: "rm-1" }]);
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect((await outcomeOf(() => markCallReviewedAction(form({ activityId: "call-1" })))).kind).toBe("returned");
    expect(db.conversationReview.update).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    db.user.findMany.mockResolvedValue([]); // not their report
    db.activity.findFirst.mockResolvedValue(callRow());
    const r = await outcomeOf(() => markCallReviewedAction(form({ activityId: "call-1" })));
    expect(r).toEqual({ kind: "returned", value: { ok: false, error: "Call not found." } });
    expect(db.conversationReview.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup to live customers and CALL activities", async () => {
    asUser({ role: "ADMIN" });
    await markCallReviewedAction(form({ activityId: "call-1" }));
    expect(db.activity.findFirst.mock.calls[0][0].where).toMatchObject({ id: "call-1", type: "CALL", client: { isDeleted: false } });
  });
});

describe("call actions: role rules", () => {
  it("lets an RM create a follow-up task for a call in scope", async () => {
    asUser({ id: "rm-1", role: "RM" });
    const r = await outcomeOf(() => createFollowUpTaskAction(form({ activityId: "call-1" })));
    expect(r).toEqual({ kind: "returned", value: { ok: true, message: "Follow-up task created." } });
    expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ clientId: "client-1", assignedToId: "rm-1" }));
  });

  it("does not let an RM mark a call reviewed, even their own", async () => {
    asUser({ id: "rm-1", role: "RM" });
    const r = await outcomeOf(() => markCallReviewedAction(form({ activityId: "call-1" })));
    expect(r).toEqual({ kind: "returned", value: { ok: false, error: "Only managers can mark a call reviewed." } });
    expect(db.conversationReview.update).not.toHaveBeenCalled();
  });

  it("records the reviewer from the session, never from the form", async () => {
    asUser({ id: "admin-1", role: "ADMIN" });
    await markCallReviewedAction(form({ activityId: "call-1", note: "Good call", reviewedById: "someone-else" }));
    expect(db.conversationReview.update.mock.calls[0][0].data).toMatchObject({ reviewedById: "admin-1", reviewNotes: "Good call" });
  });
});

describe("call actions: re-review is audited", () => {
  const reviewedBefore = new Date("2026-10-01T09:00:00Z");

  it("refuses a second review unless the page says it is a deliberate re-review", async () => {
    asUser({ id: "admin-1", role: "ADMIN" });
    db.activity.findFirst.mockResolvedValue(callRow({ reviewedAt: reviewedBefore }));
    const r = await outcomeOf(() => markCallReviewedAction(form({ activityId: "call-1" })));
    expect(r.kind === "returned" && r.value.ok).toBe(false);
    expect(db.conversationReview.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("writes an audit-log entry when an already-reviewed call is re-reviewed", async () => {
    asUser({ id: "admin-1", role: "ADMIN" });
    db.activity.findFirst.mockResolvedValue(callRow({ reviewedAt: reviewedBefore }));
    const r = await outcomeOf(() => markCallReviewedAction(form({ activityId: "call-1", rereview: "1", note: "Changed my mind" })));
    expect(r).toEqual({ kind: "returned", value: { ok: true, message: "Marked as reviewed." } });
    expect(db.conversationReview.update).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const data = db.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ userId: "admin-1", entity: "ConversationReview", entityId: "review-1", action: "call_re_reviewed" });
    expect(data.oldValue).toEqual({ reviewedById: "mgr-0", reviewedAt: reviewedBefore.toISOString() });
    // The audit row says that a note changed, never what the note said.
    expect(JSON.stringify(data)).not.toContain("Changed my mind");
  });

  it("writes the review and the audit entry in one transaction", async () => {
    asUser({ id: "admin-1", role: "ADMIN" });
    db.activity.findFirst.mockResolvedValue(callRow({ reviewedAt: reviewedBefore }));
    await markCallReviewedAction(form({ activityId: "call-1", rereview: "1" }));
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("does not add an audit row for a first review", async () => {
    asUser({ id: "admin-1", role: "ADMIN" });
    await markCallReviewedAction(form({ activityId: "call-1" }));
    expect(db.conversationReview.update).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
