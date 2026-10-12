import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const db = vi.hoisted(() => ({
  conversationReview: { findUnique: vi.fn(), update: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { submitQualityReviewAction } from "./actions";

const reviews: Record<string, { id: string; assignedRmId: string | null }> = {
  own: { id: "own", assignedRmId: "rm-1" },
  other: { id: "other", assignedRmId: "rm-9" },
  pool: { id: "pool", assignedRmId: null },
};
const form = (reviewId: string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("reviewId", reviewId);
  f.set("reviewNotes", "Handled well");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue([{ id: "rm-1" }]); // mgr-1's direct report
  db.conversationReview.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => reviews[where.id] ?? null);
  db.conversationReview.update.mockResolvedValue({});
});

describe("submitQualityReviewAction: who may write a review", () => {
  it("sends a signed-out caller to /login and writes nothing", async () => {
    asAnonymous();
    expect(await outcomeOf(() => submitQualityReviewAction(form("own")))).toEqual({ kind: "redirect", url: "/login" });
    expect(db.conversationReview.update).not.toHaveBeenCalled();
  });
  it.each(["RM", "DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER", "FINANCE"] as const)("bounces the %s role", async (role) => {
    asUser({ id: "rm-1", role });
    expect((await outcomeOf(() => submitQualityReviewAction(form("own")))).kind).toBe("redirect");
    expect(db.conversationReview.update).not.toHaveBeenCalled();
  });
  it("lets an admin review any conversation, recording the session user", async () => {
    const admin = asUser({ role: "ADMIN" });
    expect((await outcomeOf(() => submitQualityReviewAction(form("other", { overriddenScore: "70" })))).kind).toBe("returned");
    expect(db.conversationReview.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "other" }, data: expect.objectContaining({ reviewedById: admin.id, overriddenScore: 70 }) }));
  });
  it("lets a manager review a direct report's conversation and one nobody owns yet", async () => {
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect((await outcomeOf(() => submitQualityReviewAction(form("own")))).kind).toBe("returned");
    expect((await outcomeOf(() => submitQualityReviewAction(form("pool")))).kind).toBe("returned");
    expect(db.conversationReview.update).toHaveBeenCalledTimes(2);
  });
  it("refuses a manager a conversation of someone outside their team, and writes nothing", async () => {
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect((await outcomeOf(() => submitQualityReviewAction(form("other")))).kind).toBe("notFound");
    expect(db.conversationReview.update).not.toHaveBeenCalled();
  });
  it("answers an unknown review exactly like an out-of-scope one (nothing to probe)", async () => {
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect(await outcomeOf(() => submitQualityReviewAction(form("nope")))).toEqual(await outcomeOf(() => submitQualityReviewAction(form("other"))));
    expect(db.conversationReview.update).not.toHaveBeenCalled();
  });
  it("still rejects a score outside 0 to 100 before touching the database", async () => {
    asUser({ role: "ADMIN" });
    expect((await outcomeOf(() => submitQualityReviewAction(form("own", { overriddenScore: "101" })))).kind).toBe("threw");
    expect(db.conversationReview.findUnique).not.toHaveBeenCalled();
  });
});
