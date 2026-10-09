import { describe, expect, it } from "vitest";
import { getLastHash, recordFailure, recordSuccess, type LedgerDb } from "./ledger";

type Row = { clientId: string; lastHash: string; lastPushedAt: Date; lastError: string | null };

// Tiny in-memory fake that mimics the Prisma calls the ledger uses (findUnique / upsert).
function fakeDb(): { db: LedgerDb; rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const db: LedgerDb = {
    cleverTapSync: {
      findUnique: async ({ where }) => { const r = rows.get(where.clientId); return r ? { lastHash: r.lastHash } : null; },
      upsert: async ({ where, create, update }) => {
        const r = rows.get(where.clientId);
        if (!r) rows.set(where.clientId, { lastPushedAt: new Date(), lastError: null, ...create });
        else rows.set(where.clientId, { ...r, ...update });
      },
    },
  };
  return { db, rows };
}

describe("ledger", () => {
  it("no row -> null", async () => {
    expect(await getLastHash(fakeDb().db, "c1")).toBeNull();
  });
  it("failure with no prior success stores empty hash, which reads back as null", async () => {
    const { db, rows } = fakeDb();
    await recordFailure(db, "c1", "boom");
    expect(rows.get("c1")).toMatchObject({ lastHash: "", lastError: "boom" });
    expect(await getLastHash(db, "c1")).toBeNull();
  });
  it("success stores the hash and clears the error", async () => {
    const { db, rows } = fakeDb();
    await recordFailure(db, "c1", "boom");
    await recordSuccess(db, "c1", "H1");
    expect(rows.get("c1")).toMatchObject({ lastHash: "H1", lastError: null });
    expect(await getLastHash(db, "c1")).toBe("H1");
  });
  it("fail -> success -> fail keeps the success hash and only updates lastError", async () => {
    const { db, rows } = fakeDb();
    await recordFailure(db, "c1", "e1");
    await recordSuccess(db, "c1", "H1");
    const pushedAt = rows.get("c1")!.lastPushedAt;
    await recordFailure(db, "c1", "e2");
    expect(rows.get("c1")).toMatchObject({ lastHash: "H1", lastError: "e2" });
    expect(rows.get("c1")!.lastPushedAt).toBe(pushedAt);
  });
  it("truncates very long error messages", async () => {
    const { db, rows } = fakeDb();
    await recordFailure(db, "c1", "x".repeat(5000));
    expect(rows.get("c1")!.lastError!.length).toBeLessThanOrEqual(500);
  });
});

describe("recordChecked", () => {
  it("creates a row with empty hash when missing; on existing rows touches only lastCheckedAt", async () => {
    const { recordChecked } = await import("./ledger");
    const calls: Parameters<LedgerDb["cleverTapSync"]["upsert"]>[0][] = [];
    const db: LedgerDb = { cleverTapSync: { findUnique: async () => null, upsert: async (a) => { calls.push(a); } } };
    const at = new Date(5);
    await recordChecked(db, "c1", at);
    expect(calls[0]).toEqual({ where: { clientId: "c1" }, create: { clientId: "c1", lastHash: "", lastCheckedAt: at }, update: { lastCheckedAt: at } });
  });
});
