/**
 * Performance budgets for the Partner workspace's reads, against a VOLUME database (about 5,000 partners, 300,000 accruals, 50,000
 * payout lines; the seed lives outside the repository, see docs/partner-workspace.md, "Scale"). Skipped unless
 * PARTNER_PERF_DB_TEST=1 and the database is local:
 *
 *   PARTNER_PERF_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<volume db> npx vitest run src/lib/partners/native/perf.db.test.ts
 *
 * Each read runs twice (the first warms the cache) and the faster time must be inside its budget. The budgets are about twice what the
 * workspace measured after the index migration, so a lost index or a query that scans the whole accrual table fails here.
 * PARTNER_PERF_SCALE multiplies every budget (use a small number to see the test fail).
 */
import { afterAll, describe, expect, it } from "vitest";

import type { NativeDb, NativePartnerPort } from "./queries";
import type { PartnerScope } from "./scope";

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.PARTNER_PERF_DB_TEST === "1" && local;
const SCALE = Number(process.env.PARTNER_PERF_SCALE ?? "1") || 1;
const NOW = new Date("2026-10-10T06:00:00Z");

type Run = (p: NativePartnerPort, partner: string) => Promise<unknown>;
/** [name, run, budget in ms for the admin view, budget for a distributor with a large network] */
const BUDGETS: [string, Run, number, number][] = [
  ["getSummary", (p) => p.getSummary(), 500, 250],
  ["getOverviewExtras", (p) => p.getOverviewExtras(), 150, 100],
  ["listPartners", (p) => p.listPartners({ limit: 25 }), 150, 100],
  ["listPartners search", (p) => p.listPartners({ q: "Volume Partner 12", limit: 25 }), 200, 100],
  ["getPartnerDetail", (p, id) => p.getPartnerDetail(id), 150, 100],
  ["getNetwork", (p) => p.getNetwork({ limit: 25 }), 500, 200],
  ["listReferred", (p) => p.listReferred({ limit: 25 }), 300, 150],
  ["listReferred search", (p) => p.listReferred({ q: "VOLC-0001", limit: 25 }), 400, 200],
  ["listCommissions", (p) => p.listCommissions({ limit: 25 }), 250, 150],
  ["listCommissions search", (p) => p.listCommissions({ q: "VOLC-0001", limit: 25 }), 700, 200],
  ["listAdjustments", (p) => p.listAdjustments({ limit: 25 }), 100, 100],
  ["listPayoutRuns", (p) => p.listPayoutRuns({ limit: 25 }), 100, 100],
  ["listPayouts", (p) => p.listPayouts({ limit: 25 }), 250, 150],
  ["listOpenAccruals", (p) => p.listOpenAccruals({ limit: 25 }), 600, 250],
  ["listPeriodStatements month", (p) => p.listPeriodStatements({ kind: "month", key: "2026-09", limit: 25 }), 250, 100],
  ["listPeriodStatements fy", (p) => p.listPeriodStatements({ kind: "fy", key: "2026-27", limit: 25 }), 300, 150],
  ["getStatement run", (p, id) => p.getStatement(id, "vol-run-6"), 150, 100],
  ["getStatement month", (p, id) => p.getStatement(id, "m-2026-09"), 150, 100],
  ["getStatement fy", (p, id) => p.getStatement(id, "fy-2026-27"), 200, 100],
  ["getStatement fyc", (p, id) => p.getStatement(id, "fyc-2026-27"), 150, 100],
];

describe.skipIf(!enabled)("Partner workspace reads stay inside their time budgets at volume", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let make: typeof import("./queries").createNativePort;
  const views: { name: string; scope: PartnerScope; partner: string; col: 2 | 3 }[] = [];

  async function setup() {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    ({ createNativePort: make } = await import("./queries"));
    const count = await db.partnerProfile.count({ where: { partnerCode: { startsWith: "VOL-" } } });
    if (count < 5000) throw new Error("This test needs the volume database (see docs/partner-workspace.md, Scale).");
    // The biggest sub-tree under a root stands for a large distributor.
    const top = await db.$queryRawUnsafe<{ id: string }[]>(`
      WITH RECURSIVE t AS (SELECT id, id AS root FROM "PartnerProfile" WHERE "parentPartnerProfileId" IS NULL UNION ALL SELECT p.id, t.root FROM "PartnerProfile" p JOIN t ON p."parentPartnerProfileId" = t.id)
      SELECT root AS id FROM t GROUP BY root ORDER BY count(*) DESC LIMIT 1`);
    const root = top[0].id;
    const ids = (await db.$queryRawUnsafe<{ id: string }[]>(`WITH RECURSIVE t AS (SELECT id FROM "PartnerProfile" WHERE id = '${root}' UNION ALL SELECT p.id FROM "PartnerProfile" p JOIN t ON p."parentPartnerProfileId" = t.id) SELECT id FROM t`)).map((r) => r.id);
    views.push({ name: "admin", scope: { kind: "all" }, partner: root, col: 2 }, { name: `distributor (${ids.length} partners)`, scope: { kind: "ids", ids, detailIds: [root] }, partner: root, col: 3 });
  }

  afterAll(async () => {
    if (db) await db.$disconnect();
  });

  it("every read, for the whole programme and for a large distributor, is inside its budget", async () => {
    await setup();
    const over: string[] = [];
    const report: string[] = [];
    for (const v of views) {
      const port = make(db as unknown as NativeDb, v.scope, { now: () => NOW });
      for (const [name, run, ...budgets] of BUDGETS) {
        const budget = budgets[v.col - 2] * SCALE;
        const times: number[] = [];
        for (let i = 0; i < 2; i++) {
          const t = performance.now();
          await run(port, v.partner);
          times.push(performance.now() - t);
        }
        const best = Math.min(...times);
        report.push(`${v.name} | ${name} | ${best.toFixed(0)} ms (budget ${budget.toFixed(0)})`);
        if (best > budget) over.push(`${v.name}: ${name} took ${best.toFixed(0)} ms, budget ${budget.toFixed(0)} ms`);
      }
    }
    if (process.env.PARTNER_PERF_REPORT === "1") console.log(report.join("\n"));
    expect(over).toEqual([]);
  }, 300000);
});
