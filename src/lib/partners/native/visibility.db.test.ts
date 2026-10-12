/**
 * Real-database tests for what each kind of viewer sees (partners: their own lines and their sub-partners as counts and totals;
 * team managers: counts and totals only), draft-run counts, override totals in the network, and the statement periods
 * (payout run, calendar month, financial year, financial year to date) with the data the tax maths needs.
 * Skipped unless PARTNER_NATIVE_DB_TEST=1 and the database is local.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateOverrideAccruals } from "../overrides/generate";
import { createFixture, dbTestEnabled } from "./db-fixture";
import type { NativeDb, NativePartnerPort } from "./queries";
import type { PartnerScope } from "./scope";

const NOW = new Date("2026-10-10T06:00:00Z");

describe.skipIf(!dbTestEnabled)("native partner source: visibility, draft runs and statement periods", () => {
  let f: Awaited<ReturnType<typeof createFixture>>;
  let make: typeof import("./queries").createNativePort;
  let run0 = "";
  let run1 = "";
  let run2 = "";
  const ids = (keys: string[]) => keys.map((k) => f.P[k]);
  const as = (kind: "partner-a" | "tm" | "all" | "partner-b" | "e-only"): NativePartnerPort => {
    const scope: PartnerScope =
      kind === "all"
        ? { kind: "all" }
        : kind === "partner-a"
          ? { kind: "ids", ids: ids(["a", "b", "c", "d"]), detailIds: ids(["a"]) }
          : kind === "partner-b"
            ? { kind: "ids", ids: ids(["b", "d"]), detailIds: ids(["b"]) }
            : kind === "tm"
              ? { kind: "ids", ids: ids(["a", "b"]), detailIds: [] }
              : { kind: "ids", ids: ids(["e"]), detailIds: ids(["e"]) };
    return make(f.db as unknown as NativeDb, scope, { now: () => NOW });
  };
  const codes = async (p: NativePartnerPort) => (await p.listReferred({ limit: 100 })).items.map((r) => r.clientCode).sort();

  beforeAll(async () => {
    ({ createNativePort: make } = await import("./queries"));
    f = await createFixture("pfxq");
    await f.cleanup();
    f = await createFixture("pfxq");
    for (const k of ["c1", "c2", "c3", "c4"]) await f.mkClient(k);
    const acc = { c1: await f.mkAccount("c1", "b"), c2: await f.mkAccount("c2", "d"), c3: await f.mkAccount("c3", "a"), c4: await f.mkAccount("c4", "e") };
    const A2 = await f.mkAccrual("a", acc.c3, "2000", "200", "2026-08-10T05:00:00Z");
    const A1 = await f.mkAccrual("a", acc.c3, "1000", "100", "2026-09-05T05:00:00Z");
    const A3 = await f.mkAccrual("a", acc.c3, "400", "40", "2026-10-02T05:00:00Z");
    const B1 = await f.mkAccrual("b", acc.c1, "500", "50", "2026-09-06T05:00:00Z");
    await f.mkAccrual("b", acc.c1, "300", "30", "2026-05-10T05:00:00Z");
    await f.mkAccrual("d", acc.c2, "200", "20", "2026-09-07T05:00:00Z");
    await f.mkAccrual("d", acc.c2, "50", "5", "2026-10-03T05:00:00Z");
    await f.mkAccrual("e", acc.c4, "100", "10", "2026-09-08T05:00:00Z");

    const mkRun = (start: string, end: string, status: "FINALIZED" | "APPROVED" | "DRAFT") => f.db.payoutRun.create({ data: { periodStart: new Date(start), periodEnd: new Date(end), status, createdById: f.U.fin } });
    run0 = (await mkRun("2026-07-31T18:30:00Z", "2026-08-31T18:30:00Z", "FINALIZED")).id;
    run1 = (await mkRun("2026-08-31T18:30:00Z", "2026-09-30T18:30:00Z", "APPROVED")).id;
    run2 = (await mkRun("2026-09-30T18:30:00Z", "2026-10-31T18:30:00Z", "DRAFT")).id;
    const pay = async (run: string, partner: string, amount: string, accruals: { id: string; amount: string }[], status: "RECONCILED_EXTERNALLY" | "APPROVED" | "ESTIMATED") => {
      const p = await f.db.payout.create({ data: { payoutRunId: run, partnerProfileId: f.P[partner], totalAccrualAmount: amount, netPayableAmount: amount, status } });
      await f.db.payoutLine.createMany({ data: accruals.map((a) => ({ payoutId: p.id, commissionAccrualId: a.id, amount: a.amount })) });
      return p;
    };
    await pay(run0, "a", "200", [{ id: A2.id, amount: "200" }], "RECONCILED_EXTERNALLY");
    await pay(run1, "a", "100", [{ id: A1.id, amount: "100" }], "APPROVED");
    await pay(run1, "b", "50", [{ id: B1.id, amount: "50" }], "APPROVED");
    const draftPayoutA = await pay(run2, "a", "40", [{ id: A3.id, amount: "40" }], "ESTIMATED");
    await pay(run2, "d", "5", [], "ESTIMATED");
    // A second approved run, from before the financial year, so a count of "draft runs" cannot be mistaken for a count of any other kind.
    const run3 = await mkRun("2025-12-31T18:30:00Z", "2026-01-31T18:30:00Z", "APPROVED");
    await pay(run3.id, "a", "1", [], "APPROVED");
    // An adjustment that sits on the DRAFT run's payout: nobody but admin and finance may see it or count it.
    await f.db.commissionAdjustment.create({ data: { partnerProfileId: f.P.a, payoutId: draftPayoutA.id, amount: "-7", reason: "Draft-run clawback", createdById: f.U.fin, createdAt: new Date("2026-10-04T05:00:00Z") } });
  });
  afterAll(async () => {
    if (dbTestEnabled) await f.cleanup();
  });

  describe("referred people: own lines, sub-partners as a count", () => {
    it("a partner sees their own people and how many their sub-partners have, never those people's codes", async () => {
      const page = await as("partner-a").listReferred({ limit: 100 });
      expect(page.items.map((r) => r.clientCode)).toEqual(["PFXQ-c3"]);
      expect(page.hidden).toBe(2);
      expect(page.total).toBe(1);
    });
    it("a team manager sees no lines, only how many people there are", async () => {
      const page = await as("tm").listReferred({ limit: 100 });
      expect(page.items).toEqual([]);
      expect(page.hidden).toBe(2);
    });
    it("admin and finance see everyone and nothing is hidden", async () => {
      const page = await as("all").listReferred({ limit: 100 });
      expect((await codes(as("all"))).length).toBe(4);
      expect(page.hidden).toBe(0);
    });
    it("a partner asking for a sub-partner's people by id gets none, not an error and not the codes", async () => {
      const page = await as("partner-a").listReferred({ partnerId: f.P.b, limit: 100 });
      expect(page.items).toEqual([]);
      expect(page.hidden).toBe(1);
    });
    it("search cannot be used to find a sub-partner's customer code", async () => {
      expect(await codes(as("partner-a"))).toEqual(["PFXQ-c3"]);
      const found = await as("partner-a").listReferred({ q: "PFXQ-c1", limit: 100 });
      expect(found.items).toEqual([]);
    });
  });

  describe("commissions: own accrual lines, the rest as a total", () => {
    it("a partner sees only their own accruals and an aggregate for their sub-partners", async () => {
      const page = await as("partner-a").listCommissions({ limit: 100 });
      expect(page.total).toBe(3);
      expect(page.items.every((r) => r.partner.id === f.P.a)).toBe(true);
      expect(page.others).toEqual({ count: 4, amount: "105" });
    });
    it("a team manager sees no accrual lines, only the aggregate", async () => {
      const page = await as("tm").listCommissions({ limit: 100 });
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.others).toEqual({ count: 5, amount: "420" });
    });
    it("admin and finance see every line and no aggregate", async () => {
      const page = await as("all").listCommissions({ limit: 100 });
      expect(page.total).toBe(8);
      expect(page.others).toBeNull();
    });
    it("a partner filter on a sub-partner returns no lines", async () => {
      expect((await as("partner-a").listCommissions({ partnerId: f.P.b, limit: 100 })).items).toEqual([]);
    });
  });

  describe("draft payout runs: blind, with a count", () => {
    it("counts the draft runs that include the viewer's partners, and lists none of them", async () => {
      expect((await as("partner-a").getOverviewExtras()).hiddenRuns).toBe(1);
      expect((await as("tm").getOverviewExtras()).hiddenRuns).toBe(1);
      expect((await as("e-only").getOverviewExtras()).hiddenRuns).toBe(0);
      const runs = await as("partner-a").listPayoutRuns({ limit: 50 });
      expect(runs.items.map((r) => r.id)).not.toContain(run2);
      expect(runs.items.map((r) => r.id)).toContain(run1);
    });
    it("the runs list carries the same count, for the note beside it", async () => {
      expect((await as("partner-a").listPayoutRuns({ limit: 50 })).hiddenRuns).toBe(1);
      expect((await as("tm").listPayoutRuns({ limit: 50 })).hiddenRuns).toBe(1);
      expect((await as("all").listPayoutRuns({ limit: 50 })).hiddenRuns).toBe(0);
    });
    it("admin and finance see the draft run itself and no hidden count", async () => {
      expect((await as("all").getOverviewExtras()).hiddenRuns).toBe(0);
      expect((await as("all").listPayoutRuns({ limit: 50 })).items.map((r) => r.id)).toContain(run2);
    });
    it("an adjustment on a draft run's payout is invisible to a partner and counted for admin: on the statement and in its totals", async () => {
      const mine = (await as("partner-a").getStatement(f.P.a, "m-2026-10"))!;
      expect(mine.adjustments).toEqual([]);
      const all = (await as("all").getStatement(f.P.a, "m-2026-10"))!;
      expect(all.adjustments.map((a) => a.amount)).toEqual(["-7"]);
      expect((await as("tm").getStatement(f.P.a, "m-2026-10"))!.aggregate!.adjustments).toBe("0");
      expect((await as("all").getStatement(f.P.a, "fyc-2026-27"))!.cumulative!.months.at(-1)!.adjustments).toBe("-7");
      expect((await as("partner-a").getStatement(f.P.a, "fyc-2026-27"))!.cumulative!.months.at(-1)!.adjustments).toBe("0");
    });
    it("a draft run's statement is not found for a partner, even their own", async () => {
      expect(await as("partner-a").getStatement(f.P.a, run2)).toBeNull();
      expect(await as("all").getStatement(f.P.a, run2)).not.toBeNull();
    });
  });

  describe("statements for a payout run", () => {
    it("own statement: every line, and the data the tax maths needs", async () => {
      const s = (await as("partner-a").getStatement(f.P.a, run1))!;
      expect(s.detail).toBe("full");
      expect(s.lines).toHaveLength(1);
      expect(s.tax!.priorBase).toBe("200"); // the earlier run of the same financial year
      expect(s.tax!.facts).toEqual({ partnerType: "DISTRIBUTOR", hasPan: true, hasGstin: true });
      expect(s.tax!.at).toBe("2026-09-30T18:29:59.999Z");
    });
    it("a sub-partner's statement is totals only for a partner: no lines, no tax detail", async () => {
      const s = (await as("partner-a").getStatement(f.P.b, run1))!;
      expect(s.detail).toBe("totals");
      expect(s.lines).toEqual([]);
      expect(s.adjustments).toEqual([]);
      expect(s.aggregate).toEqual({ accruals: "50", adjustments: "0" });
      expect(s.tax).toBeNull();
      expect(JSON.stringify(s)).not.toContain("PFXQ-c1");
    });
    it("a team manager gets totals only, even for their own partners", async () => {
      const s = (await as("tm").getStatement(f.P.a, run1))!;
      expect(s.detail).toBe("totals");
      expect(s.lines).toEqual([]);
      expect(s.aggregate).toEqual({ accruals: "100", adjustments: "0" });
    });
    it("a partner does not see a partner outside their network at all", async () => {
      expect(await as("partner-a").getStatement(f.P.e, run1)).toBeNull();
    });
    it("the prior base for a later run includes every earlier approved run of the year, and not drafts", async () => {
      expect((await as("all").getStatement(f.P.a, run2))!.tax!.priorBase).toBe("300");
    });
  });

  describe("statements for a calendar month, a financial year and the year to date", () => {
    it("a calendar month lists that month's accruals (any run state), with the earlier months of the year as the prior base", async () => {
      const s = (await as("partner-a").getStatement(f.P.a, "m-2026-09"))!;
      expect(s.period).toMatchObject({ kind: "month", key: "m-2026-09" });
      expect(s.lines.map((l) => l.amount)).toEqual(["100"]);
      expect(s.tax!.priorBase).toBe("200"); // Aug 10 accrual of 200, same financial year
      expect(s.tax!.at).toBe("2026-09-30T18:29:59.999Z");
      expect(s.run).toBeNull();
      expect(s.payout).toBeNull();
    });
    it("a month before the year's first accrual has a zero prior base", async () => {
      const s = (await as("all").getStatement(f.P.b, "m-2026-05"))!;
      expect(s.lines.map((l) => l.amount)).toEqual(["30"]);
      expect(s.tax!.priorBase).toBe("0");
    });
    it("the financial year lists every accrual from April to March, with no prior base", async () => {
      const s = (await as("all").getStatement(f.P.a, "fy-2026-27"))!;
      expect(s.period).toMatchObject({ kind: "fy" });
      expect(s.lines.map((l) => l.amount).sort()).toEqual(["100", "200", "40"]);
      expect(s.tax!.priorBase).toBe("0");
      expect(s.tax!.at).toBe(NOW.toISOString()); // the year is not over: rules are read as of today
    });
    it("a year in the past reads its rules as of the last instant of that year", async () => {
      const s = (await as("all").getStatement(f.P.a, "fy-2025-26"))!;
      expect(s.lines).toEqual([]);
      expect(s.tax!.at).toBe("2026-03-31T18:29:59.999Z");
    });
    it("the year to date gives one row per month from April, and no lines", async () => {
      const s = (await as("all").getStatement(f.P.a, "fyc-2026-27"))!;
      expect(s.lines).toEqual([]);
      expect(s.cumulative!.priorBase).toBe("0");
      expect(s.cumulative!.months.map((m) => m.key)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
      expect(s.cumulative!.months.map((m) => m.accruals)).toEqual(["0", "0", "0", "0", "200", "100", "40"]);
      expect(s.cumulative!.months.map((m) => m.adjustments)).toEqual(["0", "0", "0", "0", "0", "0", "-7"]); // the draft run's clawback is in October, for admin
    });
    it("a partner gets month and year statements for themselves and totals only for a sub-partner", async () => {
      expect((await as("partner-a").getStatement(f.P.a, "m-2026-09"))!.detail).toBe("full");
      const sub = (await as("partner-a").getStatement(f.P.b, "m-2026-09"))!;
      expect(sub.detail).toBe("totals");
      expect(sub.aggregate).toEqual({ accruals: "50", adjustments: "0" });
      expect(await as("partner-a").getStatement(f.P.e, "m-2026-09")).toBeNull();
    });
    it("an invalid period key is missing, not an error", async () => {
      expect(await as("all").getStatement(f.P.a, "m-2026-13")).toBeNull();
      expect(await as("all").getStatement(f.P.a, "fy-2026-99")).toBeNull();
    });
    it("loads the tax rules that exist", async () => {
      await f.db.partnerTaxRule.create({ data: { kind: "TDS", label: "Section Q", ratePercent: "10", thresholdAmount: "1000", partnerTypes: [], effectiveFrom: new Date("2026-04-01T00:00:00Z"), createdById: f.U.fin, approvedById: f.U.fin2 } });
      const s = (await as("all").getStatement(f.P.a, "m-2026-09"))!;
      expect(s.tax!.rules).toHaveLength(1);
      expect(s.tax!.rules[0]).toMatchObject({ kind: "TDS", label: "Section Q", ratePercent: "10", thresholdAmount: "1000" });
    });
  });

  describe("statement index by month and year", () => {
    it("lists the partners with accruals in a month, with their totals, for the viewer's scope", async () => {
      const all = await as("all").listPeriodStatements({ kind: "month", key: "2026-09", limit: 50 });
      expect(Object.fromEntries(all.items.map((r) => [r.partner.code, r.total]))).toEqual({ "PFXQ-A": "100", "PFXQ-B": "50", "PFXQ-D": "20", "PFXQ-E": "10" });
      const mine = await as("partner-a").listPeriodStatements({ kind: "month", key: "2026-09", limit: 50 });
      expect(mine.items.map((r) => r.partner.code).sort()).toEqual(["PFXQ-A", "PFXQ-B", "PFXQ-D"]);
      expect(mine.total).toBe(3);
    });
    it("lists the partners with accruals in a financial year", async () => {
      const fy = await as("all").listPeriodStatements({ kind: "fy", key: "2026-27", limit: 50 });
      expect(Object.fromEntries(fy.items.map((r) => [r.partner.code, r.total]))).toEqual({ "PFXQ-A": "340", "PFXQ-B": "80", "PFXQ-D": "25", "PFXQ-E": "10" });
    });
    it("rejects a malformed period key with an empty page", async () => {
      expect((await as("all").listPeriodStatements({ kind: "month", key: "2026-9", limit: 50 })).items).toEqual([]);
    });
    it("pages", async () => {
      const p = await as("all").listPeriodStatements({ kind: "fy", key: "2026-27", limit: 2, offset: 2 });
      expect(p.items).toHaveLength(2);
      expect(p.total).toBe(4);
    });
  });

  describe("override earnings in the network", () => {
    it("with no override rules there is no override column value", async () => {
      const net = await as("all").getNetwork({ limit: 100 });
      expect(net.items.every((r) => r.override === 0)).toBe(true);
    });
    it("once rules exist and are generated, the network shows override earnings and still shows branch totals without them", async () => {
      await f.db.partnerOverrideRule.create({ data: { level: 1, ratePercent: "5", effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdById: f.U.fin, approvedById: f.U.fin2 } });
      await generateOverrideAccruals(f.db as never);
      const net = await as("all").getNetwork({ limit: 100 });
      const row = (code: string) => net.items.find((r) => r.code === code)!;
      expect(row("PFXQ-A")).toMatchObject({ override: 4, own: 340, rollup: 445 });
      expect(row("PFXQ-B")).toMatchObject({ override: 1.25, own: 80, rollup: 105 });
      expect(row("PFXQ-E")).toMatchObject({ override: 0, own: 10, rollup: 10 });
    });
    it("override accruals appear as their own lines with the rule, without the sub-partner's customer", async () => {
      const page = await as("partner-a").listCommissions({ limit: 100 });
      const overrides = page.items.filter((r) => r.override);
      expect(overrides).toHaveLength(2); // from b's two accruals
      expect(overrides[0].override).toMatchObject({ level: 1, ratePercent: "5", capPerAccrual: null });
      expect(overrides[0].clientCode).toBeNull();
      expect(JSON.stringify(overrides)).not.toContain("PFXQ-c1");
    });
    it("searching a sub-partner's customer code does not surface the override lines built on that customer", async () => {
      // Override accruals share the sub-partner's revenue event, so a customer-code match must never reach them.
      const found = await as("partner-a").listCommissions({ q: "PFXQ-c1", limit: 100 });
      expect(found.items).toEqual([]);
      const own = await as("partner-a").listCommissions({ q: "PFXQ-c3", limit: 100 });
      expect(own.items.length).toBeGreaterThan(0);
      expect(own.items.every((r) => !r.override)).toBe(true);
    });
    it("a partner's earned total includes their override accruals", async () => {
      const a = (await as("all").listPartners({ limit: 100 })).items.find((r) => r.code === "PFXQ-A")!;
      expect(a.earned).toBe(344);
    });
  });
});
