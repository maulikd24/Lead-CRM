import { describe, expect, it } from "vitest";
import { coverageSql, eligibleSql, loadIdentityCoverage, prismaSelectDb, selectBatch, type SelectDb } from "./select-batch";
import { recordChecked, type LedgerDb } from "./ledger";
import { checkedAfter, runBatch } from "./batch-loop";

const flat = (q: { sql: string }) => q.sql.replace(/\s+/g, " ");

describe("eligibleSql (what a batch may pick)", () => {
  const q = flat(eligibleSql(25, false));
  it("only ACTIVE, live customers with an email or mobile", () => {
    expect(q).toContain(`c."status" = 'ACTIVE'`);
    expect(q).toContain(`c."isDeleted" = false`);
    expect(q).toContain(`c."mergedIntoId" IS NULL`);
    expect(q).toContain(`c."email"`);
    expect(q).toContain(`c."mobile"`);
  });
  it("only customers with exactly one usable app user id in the signup ledger", () => {
    expect(q).toContain(`li."source" = 'allvest_app'`);
    expect(q).toContain(`li."status" IN ('CREATED', 'DUPLICATE')`);
    expect(q).toContain(`GROUP BY li."clientId"`);
    expect(q).toContain(`COUNT(DISTINCT trim(li."externalId")) AS n`);
    expect(q).toContain("WHERE a.n = 1");
  });
  it("never-checked first (oldest first), then least recently checked, limited", () => {
    expect(q).toContain(`ORDER BY s."lastCheckedAt" ASC NULLS FIRST, c."createdAt" ASC`);
    expect(eligibleSql(25, false).values).toEqual([25]);
  });
  it("adds the coarse marketing-consent pre-filter only when asked", () => {
    expect(q).not.toContain("MARKETING_COMMS");
    const withConsent = flat(eligibleSql(25, true));
    expect(withConsent).toContain("MARKETING_COMMS");
    expect(withConsent).toContain(`"marketingConsentAt" IS NOT NULL`);
  });
});

describe("coverageSql", () => {
  it("counts the same population as three buckets: one app id, none, several", () => {
    const q = flat(coverageSql());
    expect(q).toContain(`c."status" = 'ACTIVE'`);
    expect(q).toContain("FILTER (WHERE e.n = 1)");
    expect(q).toContain("FILTER (WHERE e.n IS NULL)");
    expect(q).toContain("FILTER (WHERE e.n > 1)");
  });
});

describe("loadIdentityCoverage / prismaSelectDb", () => {
  it("reads the three counts as numbers", async () => {
    const db = { $queryRaw: async () => [{ eligible: BigInt(3), noAppId: 90, multipleAppIds: "2" }] };
    expect(await loadIdentityCoverage(db)).toEqual({ eligible: 3, noAppId: 90, multipleAppIds: 2 });
  });
  it("an empty answer is all zeros", async () => {
    expect(await loadIdentityCoverage({ $queryRaw: async () => [] })).toEqual({ eligible: 0, noAppId: 0, multipleAppIds: 0 });
  });
  it("returns ids in the order the query gives them", async () => {
    const db = prismaSelectDb({ $queryRaw: async () => [{ id: "b" }, { id: "a" }] });
    expect(await selectBatch(db, 5)).toEqual(["b", "a"]);
  });
});

describe("selectBatch rotation", () => {
  type C = { id: string; createdAt: number; appIds: number };
  /** Honours the contract of the SQL: only customers with exactly one app id, never-checked first, then oldest check. */
  function fake(clients: C[]) {
    const ledger = new Map<string, { lastCheckedAt: number | null }>();
    const db: SelectDb = {
      eligibleClientIds: async ({ limit }) => {
        const key = (c: C) => ledger.get(c.id)?.lastCheckedAt ?? -1;
        return clients.filter((c) => c.appIds === 1).sort((x, y) => key(x) - key(y) || x.createdAt - y.createdAt).slice(0, limit).map((c) => c.id);
      },
    };
    return { db, ledger };
  }
  it("passes the limit and the consent pre-filter flag through", async () => {
    const seen: unknown[] = [];
    await selectBatch({ eligibleClientIds: async (a) => { seen.push(a); return []; } }, 7, { marketingEvidence: true });
    await selectBatch({ eligibleClientIds: async (a) => { seen.push(a); return []; } }, 3);
    expect(seen).toEqual([{ limit: 7, marketingEvidence: true }, { limit: 3, marketingEvidence: false }]);
  });
  it("1000 single-id customers among 25 with no id and 25 with two ids: no slot is wasted and all 1000 are reached in ceil(1000/25) ticks", async () => {
    const clients: C[] = [];
    for (let i = 0; i < 1000; i++) clients.push({ id: `e${i}`, createdAt: i, appIds: 1 });
    for (let i = 0; i < 25; i++) clients.push({ id: `n${i}`, createdAt: 5000 + i, appIds: 0 });
    for (let i = 0; i < 25; i++) clients.push({ id: `m${i}`, createdAt: 6000 + i, appIds: 2 });
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
      expect(ids).toHaveLength(25);
      await runBatch(ids, checkedAfter(async (id) => { seen.add(id); return { status: "unchanged" }; }, async (id) => { clock++; await recordChecked(ledgerDb, id, new Date(clock)); }));
    }
    expect(seen.size).toBe(1000);
    expect([...seen].some((id) => !id.startsWith("e"))).toBe(false);
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
