/**
 * Real-database test for the override accrual generator. Skipped unless PARTNER_NATIVE_DB_TEST=1 and the database is local:
 *   PARTNER_NATIVE_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/partners/overrides/generate.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFixture, dbTestEnabled } from "../native/db-fixture";
import { generateOverrideAccruals } from "./generate";

describe.skipIf(!dbTestEnabled)("override accrual generator against a real database", () => {
  let f: Awaited<ReturnType<typeof createFixture>>;
  let src: { b1: string; d1: string };
  const overrideRows = () => f.db.commissionAccrual.findMany({ where: { overrideKey: { not: null }, partnerProfileId: { in: Object.values(f.P) } }, orderBy: { overrideKey: "asc" } });
  const addRule = (level: number, rate: string, cap: string | null = null, from = "2026-01-01T00:00:00Z") =>
    f.db.partnerOverrideRule.create({ data: { level, ratePercent: rate, capPerAccrual: cap, effectiveFrom: new Date(from), createdById: f.U.fin, approvedById: f.U["fin2"] } });

  beforeAll(async () => {
    f = await createFixture("pfxo");
    await f.cleanup();
    f = await createFixture("pfxo");
    await f.mkClient("c1");
    await f.mkClient("c2");
    const a1 = await f.mkAccount("c1", "b");
    const a2 = await f.mkAccount("c2", "d");
    const b1 = await f.mkAccrual("b", a1, "10000", "1000", "2026-09-05T05:00:00Z");
    const d1 = await f.mkAccrual("d", a2, "100000", "10000", "2026-09-06T05:00:00Z");
    src = { b1: b1.id, d1: d1.id };
  });
  afterAll(async () => {
    if (dbTestEnabled) await f.cleanup();
  });

  it("with no rules it writes nothing at all (none by default)", async () => {
    const r = await generateOverrideAccruals(f.db as never);
    expect(r).toMatchObject({ rules: 0, created: 0 });
    expect(await overrideRows()).toHaveLength(0);
  });

  it("with a level-1 rule it pays the parent a share of each sub-partner accrual, as its own accrual lines", async () => {
    await addRule(1, "5");
    const r = await generateOverrideAccruals(f.db as never);
    expect(r.created).toBe(2); // b's accrual -> a, d's accrual -> b
    const rows = await overrideRows();
    const byPartner = Object.fromEntries(rows.map((x) => [x.partnerProfileId, x]));
    expect(Number(byPartner[f.P.a].accrualAmount)).toBe(50); // 5% of 1,000
    expect(Number(byPartner[f.P.b].accrualAmount)).toBe(500); // 5% of 10,000
    for (const row of rows) {
      expect(row.commissionRuleId).toBeNull();
      expect(row.status).toBe("ACCRUED");
      expect(row.overrideRuleId).not.toBeNull();
      expect(row.computationVersion).toBe("override-v1");
    }
    expect(rows.map((x) => x.sourceAccrualId).sort()).toEqual([src.b1, src.d1].sort());
  });

  it("running it again changes nothing (idempotent)", async () => {
    const before = await overrideRows();
    const r = await generateOverrideAccruals(f.db as never);
    expect(r).toMatchObject({ created: 0, updated: 0 });
    expect(await overrideRows()).toHaveLength(before.length);
  });

  it("a level-2 rule with a cap reaches the grandparent, capped per accrual", async () => {
    await addRule(2, "10", "300");
    const r = await generateOverrideAccruals(f.db as never);
    expect(r.created).toBe(1); // only d's accrual has a grandparent (a)
    const l2 = (await overrideRows()).find((x) => x.partnerProfileId === f.P.a && Number(x.accrualAmount) === 300);
    expect(l2).toBeDefined(); // 10% of 10,000 = 1,000, capped at 300
  });

  it("a changed source amount updates an open override but never one already in a payout", async () => {
    await f.db.commissionAccrual.update({ where: { id: src.b1 }, data: { accrualAmount: "2000" } });
    const r = await generateOverrideAccruals(f.db as never);
    expect(r.updated).toBe(1);
    const toA = (await overrideRows()).find((x) => x.partnerProfileId === f.P.a && x.sourceAccrualId === src.b1)!;
    expect(Number(toA.accrualAmount)).toBe(100);
    await f.db.commissionAccrual.update({ where: { id: toA.id }, data: { status: "INCLUDED_IN_PAYOUT" } });
    await f.db.commissionAccrual.update({ where: { id: src.b1 }, data: { accrualAmount: "3000" } });
    const again = await generateOverrideAccruals(f.db as never);
    expect(again.updated).toBe(0);
    expect(Number((await f.db.commissionAccrual.findUnique({ where: { id: toA.id } }))!.accrualAmount)).toBe(100);
  });

  it("never turns an override accrual into the source of another override", async () => {
    const before = (await overrideRows()).length;
    await generateOverrideAccruals(f.db as never);
    expect((await overrideRows()).length).toBe(before);
  });

  it("an ancestor whose empanelment is terminated earns nothing", async () => {
    await f.db.partnerProfile.update({ where: { id: f.P.b }, data: { empanelmentStatus: "TERMINATED" } });
    const a2 = await f.mkAccount("c2", "d");
    await f.mkAccrual("d", a2, "1000", "100", "2026-09-07T05:00:00Z");
    await generateOverrideAccruals(f.db as never);
    const toB = (await overrideRows()).filter((x) => x.partnerProfileId === f.P.b);
    expect(toB).toHaveLength(1); // only the one generated before termination
  });
});
