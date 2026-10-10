import { beforeEach, describe, expect, it, vi } from "vitest";

import { asAnonymous, asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const db = vi.hoisted(() => ({
  client: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
const merge = vi.hoisted(() => ({ mergeClientRecords: vi.fn() }));
vi.mock("@/lib/clients/merge", async (orig) => ({ ...(await orig<object>()), mergeClientRecords: merge.mergeClientRecords }));
vi.mock("@/lib/stage-engine/next-action", () => ({ syncNextAction: vi.fn() }));

import { mergeClientsAction, searchClientsForMergeAction } from "./actions";

const rows: Record<string, { id: string; assignedToId: string | null }> = {
  p1: { id: "p1", assignedToId: "rm-1" },
  d1: { id: "d1", assignedToId: "rm-1" },
  other: { id: "other", assignedToId: "rm-9" },
  pool: { id: "pool", assignedToId: null },
};

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue([]);
  // The action asks for the clients it is about to merge, filtered however it likes; return what exists for the ids asked.
  db.client.findMany.mockImplementation(async (args?: { where?: { id?: { in?: string[] } } }) => (args?.where?.id?.in ?? []).map((id) => rows[id]).filter(Boolean));
  merge.mergeClientRecords.mockResolvedValue({ conflicts: [] });
});

describe("mergeClientsAction: who can merge", () => {
  it("sends a signed-out caller to /login", async () => {
    asAnonymous();
    expect(await outcomeOf(() => mergeClientsAction("p1", ["d1"]))).toEqual({ kind: "redirect", url: "/login" });
    expect(merge.mergeClientRecords).not.toHaveBeenCalled();
  });
  it.each(["DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER", "FINANCE"] as const)("bounces the %s role", async (role) => {
    asUser({ role });
    expect((await outcomeOf(() => mergeClientsAction("p1", ["d1"]))).kind).toBe("redirect");
    expect(merge.mergeClientRecords).not.toHaveBeenCalled();
  });
  it("sends a user who must change their password to /change-password", async () => {
    asUser({ role: "ADMIN", mustChangePassword: true });
    expect(await outcomeOf(() => mergeClientsAction("p1", ["d1"]))).toEqual({ kind: "redirect", url: "/change-password" });
  });
  it("refuses an empty merge, and merging a customer into itself", async () => {
    asUser({ role: "ADMIN" });
    expect((await outcomeOf(() => mergeClientsAction("p1", []))).kind).toBe("threw");
    expect((await outcomeOf(() => mergeClientsAction("p1", ["p1"]))).kind).toBe("threw");
    expect(merge.mergeClientRecords).not.toHaveBeenCalled();
  });
  it("records the session user as the actor", async () => {
    const admin = asUser({ role: "ADMIN" });
    expect((await outcomeOf(() => mergeClientsAction("p1", ["d1"]))).kind).toBe("returned");
    expect(merge.mergeClientRecords).toHaveBeenCalledWith(expect.anything(), "p1", "d1", admin.id);
  });
});

describe("mergeClientsAction: scope", () => {
  it("lets an RM merge two of their own customers", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect((await outcomeOf(() => mergeClientsAction("p1", ["d1"]))).kind).toBe("returned");
    expect(merge.mergeClientRecords).toHaveBeenCalledTimes(1);
  });
  it("refuses an RM who tries to merge someone else's customer into their own", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect((await outcomeOf(() => mergeClientsAction("p1", ["other"]))).kind).toBe("threw");
    expect(merge.mergeClientRecords).not.toHaveBeenCalled();
  });
  it("refuses an RM who tries to merge their customer into someone else's", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect((await outcomeOf(() => mergeClientsAction("other", ["d1"]))).kind).toBe("threw");
    expect(merge.mergeClientRecords).not.toHaveBeenCalled();
  });
  it("refuses a partial batch: if any duplicate is out of scope nothing is merged", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect((await outcomeOf(() => mergeClientsAction("p1", ["d1", "other"]))).kind).toBe("threw");
    expect(merge.mergeClientRecords).not.toHaveBeenCalled();
  });
  it("gives the same answer for an unknown id as for an out-of-scope one", async () => {
    asUser({ id: "rm-1", role: "RM" });
    const unknown = await outcomeOf(() => mergeClientsAction("p1", ["nope"]));
    const hidden = await outcomeOf(() => mergeClientsAction("p1", ["other"]));
    if (unknown.kind !== "threw" || hidden.kind !== "threw") throw new Error("both should be refused");
    expect((unknown.error as Error).message).toBe((hidden.error as Error).message);
  });
  it("lets a manager merge a direct report's customers, and the unassigned pool, but not another team's", async () => {
    db.user.findMany.mockResolvedValue([{ id: "rm-1" }]);
    asUser({ id: "mgr-1", role: "MANAGER" });
    expect((await outcomeOf(() => mergeClientsAction("p1", ["d1", "pool"]))).kind).toBe("returned");
    vi.clearAllMocks();
    db.client.findMany.mockImplementation(async (args?: { where?: { id?: { in?: string[] } } }) => (args?.where?.id?.in ?? []).map((id) => rows[id]).filter(Boolean));
    db.user.findMany.mockResolvedValue([{ id: "rm-1" }]);
    expect((await outcomeOf(() => mergeClientsAction("p1", ["other"]))).kind).toBe("threw");
    expect(merge.mergeClientRecords).not.toHaveBeenCalled();
  });
  it("lets an admin merge any two customers", async () => {
    asUser({ role: "ADMIN" });
    expect((await outcomeOf(() => mergeClientsAction("p1", ["other"]))).kind).toBe("returned");
  });
});

describe("searchClientsForMergeAction", () => {
  it("sends a signed-out caller to /login and an out-of-role user away", async () => {
    asAnonymous();
    expect(await outcomeOf(() => searchClientsForMergeAction("riya", "p1"))).toEqual({ kind: "redirect", url: "/login" });
    asUser({ role: "DEALER" });
    expect((await outcomeOf(() => searchClientsForMergeAction("riya", "p1"))).kind).toBe("redirect");
    expect(db.client.findMany).not.toHaveBeenCalled();
  });
  it("only searches the caller's own customers when they are an RM", async () => {
    asUser({ id: "rm-1", role: "RM" });
    db.client.findMany.mockResolvedValue([]);
    await searchClientsForMergeAction("riya", "p1");
    const where = JSON.stringify(db.client.findMany.mock.calls[0][0].where);
    expect(where).toContain("rm-1");
    expect(where).toContain("assignedToId");
  });
  it("does not restrict an admin's search by owner", async () => {
    asUser({ role: "ADMIN" });
    db.client.findMany.mockResolvedValue([]);
    await searchClientsForMergeAction("riya", "p1");
    expect(JSON.stringify(db.client.findMany.mock.calls[0][0].where)).not.toContain("assignedToId");
  });
  it("returns nothing for a blank query without touching the database", async () => {
    asUser({ role: "ADMIN" });
    expect(await searchClientsForMergeAction("   ", "p1")).toEqual([]);
    expect(db.client.findMany).not.toHaveBeenCalled();
  });
});
