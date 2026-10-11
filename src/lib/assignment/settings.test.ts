import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; mode: string; roundRobinCursorId: string | null; updatedById: string | null };

// In-memory stand-in for the AssignmentSettings table: `id` is the primary key.
const store = vi.hoisted(() => new Map<string, Record<string, unknown>>());

const db = vi.hoisted(() => ({
  assignmentSettings: {
    // Mirrors Prisma's upsert on a unique key: the row is read, then inserted if missing. A concurrent
    // first read can insert between the read and the insert, so the loser gets a unique-violation (P2002).
    upsert: vi.fn(async ({ where, create }: { where: { id: string }; create: { id: string } }) => {
      if (store.has(where.id)) return store.get(where.id);
      await Promise.resolve(); // yield, so a concurrent caller can run its own check first
      if (store.has(where.id)) {
        throw Object.assign(new Error("Unique constraint failed on the fields: (`id`)"), { code: "P2002" });
      }
      const row = { mode: "LOAD_BASED", roundRobinCursorId: null, updatedById: null, ...create };
      store.set(where.id, row);
      return row;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = store.get(where.id);
      if (!row) throw new Error("No AssignmentSettings found");
      return row;
    }),
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

import { getAssignmentSettings } from "./settings";

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("getAssignmentSettings", () => {
  it("creates the default row on the first read and returns it", async () => {
    const settings = (await getAssignmentSettings()) as unknown as Row;

    expect(settings).toMatchObject({ id: "default", mode: "LOAD_BASED" });
    expect(store.size).toBe(1);
    expect(db.assignmentSettings.upsert).toHaveBeenCalledWith({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    });
  });

  it("does not throw and does not duplicate the row on a later read", async () => {
    await getAssignmentSettings();
    const again = (await getAssignmentSettings()) as unknown as Row;

    expect(again.id).toBe("default");
    expect(store.size).toBe(1);
  });

  it("survives two concurrent first reads on an empty table (no P2002 escapes, one row)", async () => {
    const [a, b] = await Promise.all([getAssignmentSettings(), getAssignmentSettings()]);

    expect(a).toMatchObject({ id: "default" });
    expect(b).toMatchObject({ id: "default" });
    expect(store.size).toBe(1);
  });

  it("re-reads the winning row when the insert loses the race", async () => {
    store.set("default", { id: "default", mode: "ROUND_ROBIN", roundRobinCursorId: null, updatedById: null });
    db.assignmentSettings.upsert.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on the fields: (`id`)"), { code: "P2002" }),
    );

    const settings = (await getAssignmentSettings()) as unknown as Row;

    expect(settings.mode).toBe("ROUND_ROBIN");
    expect(db.assignmentSettings.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: "default" } });
  });

  it("still propagates errors that are not unique violations", async () => {
    db.assignmentSettings.upsert.mockRejectedValueOnce(new Error("connection reset"));

    await expect(getAssignmentSettings()).rejects.toThrow("connection reset");
    expect(db.assignmentSettings.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
