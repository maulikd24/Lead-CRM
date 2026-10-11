import { beforeEach, describe, expect, it, vi } from "vitest";

import { asUser, outcomeOf, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());

const db = vi.hoisted(() => ({
  task: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  client: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/stage-engine/next-action", () => ({ syncNextAction: vi.fn() }));
vi.mock("@/lib/integrations/registry", () => ({ getAdapter: vi.fn() }));

import { completeTaskAction, createTaskAction, updateTaskAction } from "@/app/(dashboard)/tasks/actions";
import { ownTasksOnly, taskScopeFor } from "./own-tasks";

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  db.task.update.mockImplementation(async ({ where }: { where: { id: string } }) => ({ id: where.id, clientId: "c1", title: "t" }));
});

describe("task scope", () => {
  it("limits a marketing user to tasks assigned to them, whatever the visibility rule says", () => {
    expect(ownTasksOnly("MARKETING")).toBe(true);
    expect(ownTasksOnly("RM")).toBe(false);
    expect(taskScopeFor("MARKETING", "m1", [])).toEqual({ assignedToId: "m1" });
  });
  it("keeps the existing scoping for everyone else", () => {
    expect(taskScopeFor("RM", "rm1", ["rm1"])).toEqual({ assignedToId: { in: ["rm1"] } });
    expect(taskScopeFor("ADMIN", "a1", null)).toBeUndefined();
  });
});

describe("a marketing user's task actions touch only their own tasks, never a customer's", () => {
  it("refuses to complete someone else's task, and writes nothing", async () => {
    asUser({ id: "m1", role: "MARKETING" });
    db.task.findUnique.mockResolvedValue({ id: "t1", assignedToId: "rm1" });
    const r = await outcomeOf(() => completeTaskAction("t1"));
    expect(r.kind).toBe("threw");
    expect(db.task.update).not.toHaveBeenCalled();
  });
  it("refuses to reschedule someone else's task", async () => {
    asUser({ id: "m1", role: "MARKETING" });
    db.task.findUnique.mockResolvedValue({ id: "t1", assignedToId: "rm1" });
    expect((await outcomeOf(() => updateTaskAction("t1", { dueAt: "2026-11-01" }))).kind).toBe("threw");
    expect(db.task.update).not.toHaveBeenCalled();
  });
  it("completes their own task", async () => {
    asUser({ id: "m1", role: "MARKETING" });
    db.task.findUnique.mockResolvedValue({ id: "t1", assignedToId: "m1" });
    expect((await outcomeOf(() => completeTaskAction("t1"))).kind).toBe("returned");
    expect(db.task.update).toHaveBeenCalled();
  });
  it("cannot create a task: a task is attached to a customer, and marketing has none", async () => {
    asUser({ id: "m1", role: "MARKETING" });
    const fd = new FormData();
    for (const [k, v] of Object.entries({ clientId: "c1", title: "x", dueAt: "2026-11-01", assignedToId: "m1" })) fd.set(k, v);
    expect((await outcomeOf(() => createTaskAction(fd))).kind).toBe("redirect");
    expect(db.task.create).not.toHaveBeenCalled();
  });
  it("leaves an RM able to complete a task as before", async () => {
    asUser({ id: "rm1", role: "RM" });
    expect((await outcomeOf(() => completeTaskAction("t1"))).kind).toBe("returned");
  });
});
