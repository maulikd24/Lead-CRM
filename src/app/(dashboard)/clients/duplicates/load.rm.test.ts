import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  clientFindMany: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { mergeSuggestion: { count: db.count, findMany: db.findMany, findUnique: db.findUnique }, client: { findMany: db.clientFindMany } },
}));
vi.mock("@/lib/auth/visibility", () => ({ getVisibleUserIds: vi.fn(async (id: string) => [id]) }));

import { loadComparison, loadQueue } from "@/lib/identity/merge-review/load";

const rm = { id: "rm-1", role: "RM" as const };
const manager = { id: "mgr", role: "MANAGER" as const };
const row = (id: string, aOwner: string | null, bOwner: string | null) => ({
  id,
  score: 0.9,
  reasons: [],
  clientA: { id: "ca", name: "Riya Sharma", clientCode: "CL-1", assignedToId: aOwner },
  clientB: { id: "cb", name: "Zoya Verma", clientCode: "CL-2", assignedToId: bOwner },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.count.mockResolvedValue(2);
});

describe("loadQueue for an RM", () => {
  it("asks the database only for pairs that include one of their own customers", async () => {
    db.findMany.mockResolvedValue([]);
    await loadQueue(rm);
    const where = db.count.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ clientA: { assignedToId: "rm-1" } }, { clientB: { assignedToId: "rm-1" } }]);
  });
  it("lists a pair that is entirely theirs in full, and a mixed pair with the other customer hidden and flagged", async () => {
    db.findMany.mockResolvedValue([row("s1", "rm-1", "rm-1"), row("s2", "rm-1", "rm-2")]);
    const { items } = await loadQueue(rm);
    expect(items[0]).toMatchObject({ restricted: false, a: { first: "Riya", code: "CL-1" }, b: { first: "Zoya", code: "CL-2" } });
    expect(items[1]).toMatchObject({ restricted: true, a: { first: "Riya", code: "CL-1" } });
    expect(JSON.stringify(items[1].b)).not.toMatch(/Zoya|CL-2|cb/);
  });
  it("lists a customer that sits in the unassigned pool as hidden too", async () => {
    db.findMany.mockResolvedValue([row("s3", null, "rm-1")]);
    const { items } = await loadQueue(rm);
    expect(items[0].restricted).toBe(true);
    expect(JSON.stringify(items[0].a)).not.toMatch(/Riya|CL-1|ca/);
  });
  it("gives other roles an empty queue without a query", async () => {
    expect(await loadQueue({ id: "d", role: "DEALER" })).toEqual({ total: 0, items: [] });
    expect(db.findMany).not.toHaveBeenCalled();
  });
  it("shows a manager every pair, unfiltered and in full", async () => {
    db.findMany.mockResolvedValue([row("s2", "rm-1", "rm-2")]);
    const { items } = await loadQueue(manager);
    expect(db.count.mock.calls[0][0].where.OR).toBeUndefined();
    expect(items[0]).toMatchObject({ restricted: false, b: { code: "CL-2" } });
  });
});

describe("loadComparison for an RM on a pair that includes someone else's customer", () => {
  const open = (aOwner: string | null, bOwner: string | null) => ({
    id: "s2", status: "OPEN", score: 0.9, reasons: [],
    clientA: { id: "ca", isDeleted: false, mergedIntoId: null, assignedToId: aOwner },
    clientB: { id: "cb", isDeleted: false, mergedIntoId: null, assignedToId: bOwner },
  });
  it("returns the restricted view: own customer only, nothing to compare, nothing about the other customer", async () => {
    db.findUnique.mockResolvedValue(open("rm-1", "rm-2"));
    db.clientFindMany.mockResolvedValue([{ id: "ca", name: "Riya Sharma", clientCode: "CL-1" }]);
    const res = await loadComparison(rm, "s2");
    expect(res).toMatchObject({ ok: true, data: { restricted: true, rows: [], plans: {}, defaultSurvivorId: "ca", sides: { a: { first: "Riya", code: "CL-1" } } } });
    expect(JSON.stringify(res)).not.toMatch(/cb|rm-2|Zoya|CL-2/);
    expect(db.clientFindMany.mock.calls[0][0].where.assignedToId).toBe("rm-1");
  });
  it("answers a pair with none of their customers exactly like a missing suggestion", async () => {
    db.findUnique.mockResolvedValueOnce(open("rm-2", "rm-3")).mockResolvedValueOnce(null);
    const unrelated = await loadComparison(rm, "s2");
    const missing = await loadComparison(rm, "nope");
    expect(unrelated).toEqual(missing);
    expect(unrelated.ok).toBe(false);
  });
  it("refuses other roles before reading anything", async () => {
    expect(await loadComparison({ id: "d", role: "DEALER" }, "s2")).toMatchObject({ ok: false });
    expect(db.findUnique).not.toHaveBeenCalled();
  });
});
