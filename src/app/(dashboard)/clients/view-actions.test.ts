import { beforeEach, describe, expect, it, vi } from "vitest";

import { asUser, resetSession } from "@/test/session-harness";

vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
vi.mock("@/lib/activities/log-activity", () => ({ logActivity: vi.fn() }));

const db = vi.hoisted(() => ({
  client: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  user: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  savedView: { findFirst: vi.fn(), count: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { deleteClientViewAction, saveClientViewAction, setClientPriorityAction } from "./view-actions";

beforeEach(() => {
  resetSession();
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue([{ id: "rm-team" }]);
  db.client.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({ other: { assignedToId: "rm-9" }, own: { assignedToId: "rm-1" } })[where.id] ?? null);
  db.client.findFirst.mockResolvedValue({ priority: "MEDIUM" });
  db.savedView.upsert.mockImplementation(async ({ create }: { create: { name: string; query: string } }) => ({ id: "v1", name: create.name, query: create.query }));
});

describe("inline priority", () => {
  it("an RM changes the priority of their own client, with an audit row", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect(await setClientPriorityAction("own", "HIGH")).toEqual({ ok: true, previous: "MEDIUM" });
    expect(db.client.update).toHaveBeenCalledWith({ where: { id: "own" }, data: { priority: "HIGH" } });
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "priority_changed", oldValue: { priority: "MEDIUM" }, newValue: { priority: "HIGH" } }) }));
  });
  it("refuses another RM's client and a value that is not a priority, without writing", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect(await setClientPriorityAction("other", "HIGH")).toEqual({ ok: false, error: "Client not found." });
    expect(await setClientPriorityAction("own", "URGENT")).toMatchObject({ ok: false });
    expect(db.client.update).not.toHaveBeenCalled();
  });
  it("does nothing when the priority is unchanged", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect(await setClientPriorityAction("own", "MEDIUM")).toEqual({ ok: true, previous: "MEDIUM" });
    expect(db.client.update).not.toHaveBeenCalled();
  });
});

describe("saved views", () => {
  it("saves only known filter keys, canonically, for the caller alone", async () => {
    asUser({ id: "rm-1", role: "RM" });
    db.savedView.findFirst.mockResolvedValue(null);
    db.savedView.count.mockResolvedValue(0);
    const r = await saveClientViewAction("  Hot  leads ", "view=board&priority=HIGH&page=3&evil=1");
    expect(r).toEqual({ ok: true, view: { id: "v1", name: "Hot leads", query: "priority=HIGH&view=board" } });
    expect(db.savedView.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_scope_name: { userId: "rm-1", scope: "clients", name: "Hot leads" } } }));
  });
  it("caps the number of views, but always allows replacing one by name", async () => {
    asUser({ id: "rm-1", role: "RM" });
    db.savedView.count.mockResolvedValue(20);
    db.savedView.findFirst.mockResolvedValue(null);
    expect(await saveClientViewAction("New one", "")).toMatchObject({ ok: false, error: expect.stringMatching(/up to 20/) });
    db.savedView.findFirst.mockResolvedValue({ id: "v1" });
    expect(await saveClientViewAction("Existing", "")).toMatchObject({ ok: true });
  });
  it("rejects an unusable name", async () => {
    asUser({ id: "rm-1", role: "RM" });
    expect(await saveClientViewAction("x", "")).toMatchObject({ ok: false });
    expect(db.savedView.upsert).not.toHaveBeenCalled();
  });
  it("deletes only the caller's own view", async () => {
    asUser({ id: "rm-1", role: "RM" });
    db.savedView.deleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteClientViewAction("someone-elses")).toMatchObject({ ok: false });
    expect(db.savedView.deleteMany).toHaveBeenCalledWith({ where: { id: "someone-elses", userId: "rm-1", scope: "clients" } });
  });
});
