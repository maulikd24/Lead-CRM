import { describe, expect, it } from "vitest";
import { selectBatch, type SelectArgs, type SelectDb } from "./select-batch";
import { recordChecked, type LedgerDb } from "./ledger";
import { checkedAfter, runBatch } from "./batch-loop";

type C = { id: string; createdAt: number; hasIdentity: boolean };
type L = { lastCheckedAt: number | null };

function fake(clients: C[]) {
  const ledger = new Map<string, L>();
  const queries: SelectArgs[] = [];
  const db: SelectDb = {
    client: {
      findMany: async (args: SelectArgs) => {
        queries.push(args);
        const w = args.where;
        let rows = clients.filter((c) => c.hasIdentity); // the fake only honours the identity filter if the query asks for it
        if (!w.OR) rows = clients;
        // single query: ordered by ledger lastCheckedAt asc nulls first (no ledger row == null), then createdAt asc
        const key = (c: C) => ledger.get(c.id)?.lastCheckedAt ?? -1;
        expect(args.orderBy[0].cleverTapSync.lastCheckedAt).toEqual({ sort: "asc", nulls: "first" });
        rows = [...rows].sort((x, y) => key(x) - key(y) || x.createdAt - y.createdAt);
        return rows.slice(0, args.take).map((c) => ({ id: c.id }));
      },
    },
  };
  return { db, ledger, queries };
}

describe("selectBatch", () => {
  it("filters to customers with an identity (non-null, non-empty email or mobile) and ACTIVE/not deleted/not merged", async () => {
    const { db, queries } = fake([{ id: "a", createdAt: 1, hasIdentity: true }]);
    await selectBatch(db, 5);
    expect(queries).toHaveLength(1);
    for (const q of queries) {
      expect(q.where.status).toBe("ACTIVE");
      expect(q.where.isDeleted).toBe(false);
      expect(q.where.mergedIntoId).toBeNull();
      expect(JSON.stringify(q.where.OR)).toContain('"email"');
      expect(JSON.stringify(q.where.OR)).toContain('"mobile"');
    }
  });
  it("never-seen customers come first (oldest first, one query), then least recently checked; limit respected", async () => {
    const { db, ledger } = fake([
      { id: "old", createdAt: 1, hasIdentity: true },
      { id: "new", createdAt: 9, hasIdentity: true },
      { id: "checkedOld", createdAt: 2, hasIdentity: true },
      { id: "checkedNew", createdAt: 3, hasIdentity: true },
    ]);
    ledger.set("checkedOld", { lastCheckedAt: 10 });
    ledger.set("checkedNew", { lastCheckedAt: 50 });
    expect(await selectBatch(db, 3)).toEqual(["old", "new", "checkedOld"]);
    expect(await selectBatch(db, 1)).toEqual(["old"]);
    expect(await selectBatch(db, 10)).toEqual(["old", "new", "checkedOld", "checkedNew"]);
  });
  it("reviewer simulation: 25 identity-less newest + 1000 eligible all get reached within ceil(1000/25) ticks", async () => {
    const clients: C[] = [];
    for (let i = 0; i < 1000; i++) clients.push({ id: `e${i}`, createdAt: i, hasIdentity: true });
    for (let i = 0; i < 25; i++) clients.push({ id: `n${i}`, createdAt: 5000 + i, hasIdentity: false });
    const { db, ledger } = fake(clients);
    let clock = 0;
    const seen = new Set<string>();
    const ledgerDb: LedgerDb = {
      cleverTapSync: {
        findUnique: async () => null,
        upsert: async ({ where, create, update }) => {
          const r = ledger.get(where.clientId);
          if (!r) ledger.set(where.clientId, { lastCheckedAt: create.lastCheckedAt?.getTime() ?? null });
          else r.lastCheckedAt = update.lastCheckedAt?.getTime() ?? null;
        },
      },
    };
    for (let tick = 0; tick < 40; tick++) {
      const ids = await selectBatch(db, 25);
      await runBatch(ids, checkedAfter(async (id) => { seen.add(id); return { status: "unchanged" }; }, async (id) => { clock++; await recordChecked(ledgerDb, id, new Date(clock)); }));
    }
    expect(seen.size).toBe(1000);
    expect([...seen].some((id) => id.startsWith("n"))).toBe(false);
  });
});

describe("checkedAfter", () => {
  it("marks checked after every non-retry outcome, not after retry", async () => {
    const marked: string[] = [];
    const push = checkedAfter(async (id) => ({ status: id === "r" ? "retry" : id === "f" ? "failed" : "pushed" }), async (id) => { marked.push(id); });
    await push("p"); await push("f"); await push("r");
    expect(marked).toEqual(["p", "f"]);
  });
  it("a throwing mark does not break the result", async () => {
    const push = checkedAfter(async () => ({ status: "pushed" }), async () => { throw new Error("db"); });
    expect(await push("x")).toEqual({ status: "pushed" });
  });
});
