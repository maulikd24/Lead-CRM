/**
 * Real-database test for the native Partner source: builds a small synthetic partner network, referred people,
 * accruals and payouts, then checks scope, attribution, totals, paging and statements against real Postgres.
 *
 * Skipped unless PARTNER_NATIVE_DB_TEST=1, and refuses any non-local database:
 *   PARTNER_NATIVE_DB_TEST=1 DATABASE_URL=postgresql://postgres@127.0.0.1:55432/<scratch db> npx vitest run src/lib/partners/native/queries.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NativeDb, NativePartnerPort } from "./queries";

const url = process.env.DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^/]*@?(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url);
const enabled = process.env.PARTNER_NATIVE_DB_TEST === "1" && local;

const TAG = "pntq";
const NOW = new Date("2026-10-10T06:00:00Z");

describe.skipIf(!enabled)("native partner source against a real database", () => {
  let db: typeof import("@/lib/db/prisma").basePrisma;
  let make: typeof import("./queries").createNativePort;
  const P: Record<string, string> = {};
  const C: Record<string, string> = {};
  let runId = "";
  let draftRunId = "";
  const created = { users: [] as string[], clients: [] as string[], partners: [] as string[], events: [] as string[], accruals: [] as string[], runs: [] as string[], payouts: [] as string[], plans: [] as string[], rules: [] as string[], accounts: [] as string[] };

  const port = (ids: string[] | "all"): NativePartnerPort => make(db as unknown as NativeDb, ids === "all" ? { kind: "all" } : { kind: "ids", ids: ids.map((k) => P[k] ?? k) }, { now: () => NOW });

  beforeAll(async () => {
    ({ basePrisma: db } = await import("@/lib/db/prisma"));
    ({ createNativePort: make } = await import("./queries"));
    await cleanup();

    const stage = (await db.stage.findFirst()) ?? (await db.stage.create({ data: { name: "Partner native test stage", sequence: 9101, slaHours: 24 } }));
    const maker = await db.user.create({ data: { name: "Test Finance", email: `${TAG}-fin@example.test`, passwordHash: "x", role: "FINANCE" } });
    created.users.push(maker.id);

    // a -> b -> d ; a -> c ; e alone
    const spec: [string, string | null, "DISTRIBUTOR" | "PARTNER" | "AFFILIATE", "GOLD" | "SILVER" | "BRONZE", "ACTIVE" | "ONBOARDING"][] = [
      ["a", null, "DISTRIBUTOR", "GOLD", "ACTIVE"],
      ["b", "a", "PARTNER", "SILVER", "ACTIVE"],
      ["c", "a", "AFFILIATE", "BRONZE", "ONBOARDING"],
      ["d", "b", "AFFILIATE", "BRONZE", "ACTIVE"],
      ["e", null, "PARTNER", "SILVER", "ACTIVE"],
    ];
    for (const [k, parent, type, tier, status] of spec) {
      const u = await db.user.create({ data: { name: `Partner ${k.toUpperCase()} Associates`, email: `${TAG}-${k}@example.test`, passwordHash: "x", role: type === "DISTRIBUTOR" ? "DISTRIBUTOR" : type === "PARTNER" ? "PARTNER" : "AFFILIATE" } });
      created.users.push(u.id);
      const p = await db.partnerProfile.create({
        data: { userId: u.id, partnerCode: `PNTQ-${k.toUpperCase()}`, partnerType: type, tier, empanelmentStatus: status, parentPartnerProfileId: parent ? P[parent] : null, bankAccountLast4: k === "b" ? "9876" : null, bankVerifiedAt: k === "b" ? new Date("2026-08-01T00:00:00Z") : null, panNumber: `SECRETPAN-${k}`, gstin: `SECRETGST-${k}` },
      });
      P[k] = p.id;
      created.partners.push(p.id);
    }

    const plan = await db.commissionPlan.create({ data: { code: `${TAG}-plan`, name: "Test plan" } });
    created.plans.push(plan.id);
    const rule = await db.commissionRule.create({ data: { commissionPlanId: plan.id, rateType: "PERCENT_OF_GROSS", percentRate: 1.5, createdById: maker.id, validFrom: new Date("2026-01-01T00:00:00Z") } });
    created.rules.push(rule.id);
    for (const k of ["b", "d", "e"]) await db.partnerCommissionAssignment.create({ data: { partnerProfileId: P[k], commissionPlanId: plan.id, validFrom: new Date("2026-01-01T00:00:00Z"), assignedById: maker.id } });

    const mkClient = async (key: string, name: string, extra: Record<string, unknown> = {}) => {
      const c = await db.client.create({ data: { clientCode: `PNTQ-${key}`, name, currentStageId: stage.id, ...extra } });
      C[key] = c.id;
      created.clients.push(c.id);
      return c;
    };
    const mkAccount = async (key: string, clientKey: string, partner: string | null, status: "ACTIVE" | "CLOSED" = "ACTIVE") => {
      const a = await db.tradingAccount.create({ data: { accountNumber: `PNTQ-ACC-${key}`, clientId: C[clientKey], accountType: "EQUITY", status, sourcingPartnerId: partner ? P[partner] : null } });
      created.accounts.push(a.id);
      return a;
    };
    await mkClient("c1", "Priya Sharma");
    await mkClient("c2", "Anil Kumar Singh");
    await mkClient("c3", "Lead Three", { leadAttribution: { partnerCode: "PNTQ-A", campaign: "x" }, leadSource: "Web" });
    await mkClient("c4", "Lead Four", { referralSource: "pntq-e" });
    await mkClient("c5", "Rahul Verma");
    await mkClient("c6", "Deleted Person", { leadAttribution: { partnerCode: "PNTQ-A" }, isDeleted: true });
    await mkClient("c7", "Merged Person", { leadAttribution: { partnerCode: "PNTQ-A" }, mergedIntoId: C.c1 });
    const a1 = await mkAccount("1", "c1", "b");
    const a2 = await mkAccount("2", "c2", "d");
    const a5 = await mkAccount("5", "c5", "e", "CLOSED");

    // Revenue and accruals: b gets 2, d gets 1, e gets 1.
    const mkAccrual = async (key: string, account: { id: string; clientId: string }, partner: string, gross: string, amount: string, date: string) => {
      const ev = await db.revenueEvent.create({ data: { sourceSystem: TAG, externalRef: key, tradingAccountId: account.id, clientId: account.clientId, revenueType: "BROKERAGE", grossRevenueAmount: gross, eventDate: new Date(date), rawPayload: {} } });
      created.events.push(ev.id);
      const ac = await db.commissionAccrual.create({ data: { revenueEventId: ev.id, partnerProfileId: P[partner], commissionRuleId: rule.id, accrualAmount: amount, accrualDate: new Date(date), computationVersion: "v1" } });
      created.accruals.push(ac.id);
      return ac;
    };
    const acB1 = await mkAccrual("e1", a1, "b", "10000", "150", "2026-09-05T05:00:00Z");
    const acB2 = await mkAccrual("e2", a1, "b", "333.33", "4.99995", "2026-09-20T05:00:00Z");
    await mkAccrual("e3", a2, "d", "2000", "30", "2026-09-12T05:00:00Z");
    await mkAccrual("e4", a5, "e", "1000", "15", "2026-10-02T05:00:00Z");

    // A finalised run with b's two accruals, and a draft run with e's.
    const run = await db.payoutRun.create({ data: { periodStart: new Date("2026-08-31T18:30:00Z"), periodEnd: new Date("2026-09-30T18:30:00Z"), status: "APPROVED", createdById: maker.id, approvedById: maker.id, approvedAt: new Date("2026-10-01T00:00:00Z") } });
    runId = run.id;
    const draft = await db.payoutRun.create({ data: { periodStart: new Date("2026-09-30T18:30:00Z"), periodEnd: new Date("2026-10-31T18:30:00Z"), status: "DRAFT", createdById: maker.id } });
    draftRunId = draft.id;
    created.runs.push(run.id, draft.id);
    const payB = await db.payout.create({ data: { payoutRunId: run.id, partnerProfileId: P.b, totalAccrualAmount: "154.99995", adjustmentAmount: "-10", netPayableAmount: "144.99995", status: "APPROVED" } });
    await db.payoutLine.createMany({ data: [{ payoutId: payB.id, commissionAccrualId: acB1.id, amount: "150" }, { payoutId: payB.id, commissionAccrualId: acB2.id, amount: "4.99995" }] });
    await db.commissionAdjustment.create({ data: { partnerProfileId: P.b, payoutId: payB.id, amount: "-10", reason: "Clawback test", createdById: maker.id } });
    const payE = await db.payout.create({ data: { payoutRunId: draft.id, partnerProfileId: P.e, totalAccrualAmount: "15", netPayableAmount: "15" } });
    created.payouts.push(payB.id, payE.id);
    await db.commissionAccrual.updateMany({ where: { id: { in: [acB1.id, acB2.id] } }, data: { status: "INCLUDED_IN_PAYOUT" } });
  });

  afterAll(async () => {
    if (enabled) await cleanup();
  });

  async function cleanup() {
    const partnerCodes = { startsWith: "PNTQ-" };
    const partners = await db.partnerProfile.findMany({ where: { partnerCode: partnerCodes }, select: { id: true } });
    const pids = partners.map((p) => p.id);
    const runs = await db.payoutRun.findMany({ where: { payouts: { some: { partnerProfileId: { in: pids } } } }, select: { id: true } });
    const payouts = await db.payout.findMany({ where: { partnerProfileId: { in: pids } }, select: { id: true } });
    await db.payoutLine.deleteMany({ where: { payoutId: { in: payouts.map((p) => p.id) } } });
    await db.commissionAdjustment.deleteMany({ where: { partnerProfileId: { in: pids } } });
    await db.payout.deleteMany({ where: { id: { in: payouts.map((p) => p.id) } } });
    await db.payoutRun.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } });
    await db.commissionAccrual.deleteMany({ where: { partnerProfileId: { in: pids } } });
    await db.revenueEvent.deleteMany({ where: { sourceSystem: TAG } });
    await db.tradingAccount.deleteMany({ where: { accountNumber: { startsWith: "PNTQ-ACC-" } } });
    await db.client.deleteMany({ where: { clientCode: { startsWith: "PNTQ-" } } });
    await db.partnerCommissionAssignment.deleteMany({ where: { partnerProfileId: { in: pids } } });
    await db.commissionRule.deleteMany({ where: { commissionPlan: { code: `${TAG}-plan` } } });
    await db.commissionPlan.deleteMany({ where: { code: `${TAG}-plan` } });
    // children first
    for (const id of [...pids].reverse()) await db.partnerProfile.update({ where: { id }, data: { parentPartnerProfileId: null } });
    await db.partnerProfile.deleteMany({ where: { id: { in: pids } } });
    await db.user.deleteMany({ where: { email: { startsWith: `${TAG}-` } } });
  }

  describe("referred clients and leads (attribution)", () => {
    const codes = async (p: NativePartnerPort, f: Parameters<NativePartnerPort["listReferred"]>[0] = {}) => (await p.listReferred({ limit: 100, ...f })).items.map((r) => r.clientCode).sort();

    it("the whole programme: accounts and codes, once each, never a deleted or merged record", async () => {
      expect(await codes(port("all"))).toEqual(["PNTQ-c1", "PNTQ-c2", "PNTQ-c3", "PNTQ-c4", "PNTQ-c5"]);
    });
    it("a distributor sees their own sub-tree only", async () => {
      expect(await codes(port(["a", "b", "c", "d"]))).toEqual(["PNTQ-c1", "PNTQ-c2", "PNTQ-c3"]);
    });
    it("a lower partner sees only their branch", async () => {
      expect(await codes(port(["b", "d"]))).toEqual(["PNTQ-c1", "PNTQ-c2"]);
    });
    it("matches a free-text referral source to a partner code without regard to case", async () => {
      expect(await codes(port(["e"]))).toEqual(["PNTQ-c4", "PNTQ-c5"]);
    });
    it("nobody in scope means nobody listed", async () => {
      expect(await codes(port([]))).toEqual([]);
    });
    it("a partner filter outside the scope returns nothing rather than the whole scope", async () => {
      expect(await codes(port(["b", "d"]), { partnerId: P.e })).toEqual([]);
    });
    it("splits clients from leads", async () => {
      expect(await codes(port("all"), { segment: "clients" })).toEqual(["PNTQ-c1", "PNTQ-c2", "PNTQ-c5"]);
      expect(await codes(port("all"), { segment: "leads" })).toEqual(["PNTQ-c3", "PNTQ-c4"]);
    });
    it("reports a funnel stage: a closed account is closed, a lead is a lead", async () => {
      const rows = (await port("all").listReferred({ limit: 100 })).items;
      const f = Object.fromEntries(rows.map((r) => [r.clientCode, r.funnel]));
      expect(f).toMatchObject({ "PNTQ-c1": "ACTIVE", "PNTQ-c5": "CLOSED", "PNTQ-c3": "LEAD" });
      expect((await codes(port("all"), { funnel: "CLOSED" }))).toEqual(["PNTQ-c5"]);
    });
    it("masks the name and carries no contact details", async () => {
      const rows = (await port("all").listReferred({ limit: 100 })).items;
      expect(rows.find((r) => r.clientCode === "PNTQ-c2")!.name).toBe("Anil K. S.");
      expect(JSON.stringify(rows)).not.toMatch(/mobile|email|pan/i);
    });
    it("pages with a stable total, and says how many exist past the end", async () => {
      const p = port("all");
      const first = await p.listReferred({ limit: 2, offset: 0 });
      const second = await p.listReferred({ limit: 2, offset: 2 });
      const past = await p.listReferred({ limit: 2, offset: 50 });
      expect(first.total).toBe(5);
      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(2);
      expect(new Set([...first.items, ...second.items].map((r) => r.clientId)).size).toBe(4);
      expect(past.items).toHaveLength(0);
      expect(past.total).toBe(5);
    });
    it("a search for a wildcard matches nothing, not everything", async () => {
      expect(await codes(port("all"), { q: "%" })).toEqual([]);
      expect(await codes(port("all"), { q: "c3" })).toEqual(["PNTQ-c3"]);
    });
  });

  describe("overview", () => {
    it("counts partners by status and referred people, and sums earnings exactly", async () => {
      const s = await port("all").getSummary();
      expect(s.referrers).toMatchObject({ total: 5, active: 4, pending: 1 });
      expect(s.referees).toMatchObject({ total: 5, active: 2 });
      expect(s.earnings.total).toBe(200); // 150 + 4.99995 + 30 + 15 = 199.99995 -> 200.00
      expect(s.earnings.lastMonth).toBe(185); // September: 150 + 4.99995 + 30 -> 185.00
      expect(s.earnings.lastMonthLabel).toBe("Sep 2026");
      expect(s.monthly).toHaveLength(8);
      expect(s.monthly.at(-1)).toMatchObject({ period: "2026-10", earnings: 15 });
      expect(s.topReferrers[0]).toMatchObject({ referralCode: "PNTQ-B", earningsTotal: 155 });
    });
    it("a scoped view counts only its own people and money", async () => {
      const s = await port(["e"]).getSummary();
      expect(s.referrers.total).toBe(1);
      expect(s.earnings.total).toBe(15);
      expect(s.topReferrers.map((t) => t.referralCode)).toEqual(["PNTQ-E"]);
    });
    it("extras: this month's accruals, pending payouts and the tier mix", async () => {
      const x = await port("all").getOverviewExtras();
      expect(x.accrualsThisMonth).toMatchObject({ count: 1, amount: 15, label: "Oct 2026" });
      expect(x.pendingPayouts.count).toBe(2); // b (approved run) and e (draft run, visible to all)
      expect(x.openRuns).toBe(2);
      expect(x.tierMix.reduce((n, t) => n + t.count, 0)).toBe(5);
      const scoped = await port(["e"]).getOverviewExtras();
      expect(scoped.pendingPayouts.count).toBe(0); // e's only payout is in a draft run
      expect(scoped.openRuns).toBeNull();
    });
  });

  describe("partners, tree and detail", () => {
    it("lists partners with masked bank details and no sensitive columns", async () => {
      const page = await port("all").listPartners({ limit: 100 });
      const b = page.items.find((r) => r.code === "PNTQ-B")!;
      expect(b).toMatchObject({ bankVerified: true, bankLast4: "9876", referred: 1, earned: 155 });
      expect(JSON.stringify(page)).not.toMatch(/SECRETPAN|SECRETGST|panNumber|gstin/);
    });
    it("shows a parent only when the viewer may see it", async () => {
      const own = await port(["b", "d"]).listPartners({ limit: 100 });
      expect(own.items.find((r) => r.code === "PNTQ-B")!.parent).toBeNull(); // a is above this viewer
      expect(own.items.find((r) => r.code === "PNTQ-D")!.parent).toMatchObject({ code: "PNTQ-B" });
    });
    it("draws the roll-up tree with totals that include everything below", async () => {
      const net = await port("all").getNetwork({ limit: 100 });
      const rows = net.items.filter((r) => r.code.startsWith("PNTQ-"));
      expect(rows.map((r) => `${r.depth}:${r.code}`)).toEqual(["0:PNTQ-A", "1:PNTQ-B", "2:PNTQ-D", "1:PNTQ-C", "0:PNTQ-E"]);
      expect(rows[0]).toMatchObject({ own: 0, rollup: 185 });
      expect(rows[1]).toMatchObject({ own: 155, rollup: 185 });
    });
    it("a scoped tree starts at the top of what the viewer can see", async () => {
      const net = await port(["b", "d"]).getNetwork({ limit: 100 });
      expect(net.items.map((r) => `${r.depth}:${r.code}`)).toEqual(["0:PNTQ-B", "1:PNTQ-D"]);
    });
    it("detail: plan, totals, sub-partners; and out of scope is indistinguishable from missing", async () => {
      const d = await port(["a", "b", "c", "d"]).getPartnerDetail(P.b);
      expect(d!.plan).toMatchObject({ name: "Test plan" });
      expect(d!.totals).toMatchObject({ lifetime: 155, open: 0 });
      expect(d!.subPartners.map((s) => s.code)).toEqual(["PNTQ-D"]);
      expect(await port(["b", "d"]).getPartnerDetail(P.e)).toBeNull();
      expect(await port("all").getPartnerDetail("does-not-exist")).toBeNull();
    });
  });

  describe("commissions and adjustments", () => {
    it("lists accruals with the rule, so each amount can be explained", async () => {
      const page = await port(["b", "d"]).listCommissions({ limit: 50 });
      expect(page.total).toBe(3);
      const row = page.items.find((r) => r.amount.startsWith("150"))!;
      expect(row.explain.rule).toMatchObject({ rateType: "PERCENT_OF_GROSS", percentRate: "1.5" });
      expect(row.explain.planName).toBe("Test plan");
      expect(row.clientCode).toBe("PNTQ-c1");
    });
    it("never lists another partner's accruals", async () => {
      const page = await port(["b", "d"]).listCommissions({ limit: 50 });
      expect(page.items.every((r) => ["PNTQ-B", "PNTQ-D"].includes(r.partner.code))).toBe(true);
      expect((await port(["b", "d"]).listCommissions({ partnerId: P.e })).items).toEqual([]);
    });
    it("lists adjustments", async () => {
      const page = await port(["b"]).listAdjustments({});
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ amount: "-10", reason: "Clawback test" });
    });
  });

  describe("payouts and statements", () => {
    it("a partner never sees a run that is still a draft, an admin does", async () => {
      expect((await port(["e"]).listPayoutRuns({})).items).toHaveLength(0);
      expect((await port(["e"]).listPayouts({})).items).toHaveLength(0);
      expect((await port("all").listPayoutRuns({})).items.map((r) => r.id)).toEqual(expect.arrayContaining([runId, draftRunId]));
    });
    it("run totals cover only the viewer's own payouts", async () => {
      const runs = (await port(["b", "d"]).listPayoutRuns({})).items;
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ id: runId, payouts: 1, total: 145 });
    });
    it("builds a statement from the payout's own lines and adjustments", async () => {
      const s = (await port(["b"]).getStatement(P.b, runId))!;
      expect(s.lines).toHaveLength(2);
      expect(s.adjustments).toHaveLength(1);
      expect(s.payout).toMatchObject({ net: "144.99995", adjustment: "-10" });
      expect(s.partner).toMatchObject({ code: "PNTQ-B", bankLast4: "9876" });
      expect(JSON.stringify(s)).not.toMatch(/SECRET/);
    });
    it("refuses another partner's statement and a draft run's statement for a partner", async () => {
      expect(await port(["b", "d"]).getStatement(P.e, draftRunId)).toBeNull();
      expect(await port(["e"]).getStatement(P.e, draftRunId)).toBeNull();
      expect(await port("all").getStatement(P.e, draftRunId)).not.toBeNull();
    });
    it("an unknown run is missing, not an error", async () => {
      expect(await port("all").getStatement(P.b, "no-such-run")).toBeNull();
    });
    it("the open statement holds accruals not yet in a run", async () => {
      const s = (await port("all").getStatement(P.e, "open"))!;
      expect(s.lines).toHaveLength(1);
      expect(s.payout).toBeNull();
    });
    it("lists partners with open accruals, paged", async () => {
      const page = await port("all").listOpenAccruals({ limit: 100 });
      const mine = page.items.filter((i) => i.partner.code.startsWith("PNTQ-"));
      expect(mine.map((i) => i.partner.code).sort()).toEqual(["PNTQ-D", "PNTQ-E"]);
    });
  });

  describe("the shared interface", () => {
    it("serves the referral-api shapes too", async () => {
      const p = port("all");
      expect((await p.listReferrers({ limit: 100 })).items.some((r) => r.referralCode === "PNTQ-A")).toBe(true);
      expect((await p.listReferees({ limit: 100 })).total).toBe(5);
      const w = await p.listWithdrawals({ limit: 100 });
      expect(w.summary?.byStatus.APPROVED?.count).toBeGreaterThanOrEqual(1);
      expect(await p.ping()).toEqual({ ok: true });
      await expect(port(["b"]).getReferrer(P.e)).rejects.toMatchObject({ kind: "not_found" });
    });
  });
});
