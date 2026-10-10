import { describe, expect, it } from "vitest";

import type { Summary } from "../schemas";
import {
  bankText,
  buildCommissionsVM,
  buildPeriodIndexVM,
  buildNativeOverviewVM,
  buildNetworkVM,
  buildPartnerListVM,
  buildPayoutsVM,
  buildReferredVM,
  buildStatementVM,
  holdReasons,
  scopeNote,
} from "./view-models";
import type { TaxRule } from "../tax/rules";
import type { CommissionRow, NetworkRow, PartnerRow, PayoutRow, ReferredRow, StatementData } from "./queries";
import { parseNativeQuery } from "./query";

const q = (sp: Record<string, string> = {}) => parseNativeQuery(sp);
const page = <T,>(items: T[], total: number | null, offset = 0, limit = 25) => ({ items, total, offset, limit });

const partner = (o: Partial<PartnerRow> = {}): PartnerRow => ({ id: "p1", code: "PTR-00001", name: "Asha Associates", type: "PARTNER", tier: "GOLD", status: "ACTIVE", empanelledOn: "2026-01-05T00:00:00.000Z", bankVerified: true, bankLast4: "4321", parent: null, referred: 12, earned: 12345.5, enrolled: "2026-01-01T00:00:00.000Z", ...o });

describe("bankText: only ever the last four digits", () => {
  it("shows verified with a masked tail", () => expect(bankText({ bankVerified: true, bankLast4: "4321" })).toEqual({ label: "Verified", tail: "•••• 4321", tone: "success" }));
  it("shows an unverified account without inventing a tail", () => expect(bankText({ bankVerified: false, bankLast4: null })).toEqual({ label: "Not verified", tail: null, tone: "warning" }));
  it("masks a tail longer than four digits down to four", () => expect(bankText({ bankVerified: true, bankLast4: "98764321" }).tail).toBe("•••• 4321"));
});

describe("holdReasons: what would stop a payout from being released, in words", () => {
  it("is empty when the partner is empanelled and the bank is verified", () => expect(holdReasons({ status: "ACTIVE", bankVerified: true })).toEqual([]));
  it("names a suspended or terminated partner", () => {
    expect(holdReasons({ status: "SUSPENDED", bankVerified: true })).toEqual(["Partner is suspended"]);
    expect(holdReasons({ status: "TERMINATED", bankVerified: true })).toEqual(["Partner is terminated"]);
  });
  it("does not hold an onboarding partner for their status alone: the rule is the one the approval enforces", () => expect(holdReasons({ status: "ONBOARDING", bankVerified: true })).toEqual([]));
  it("names an unverified bank", () => expect(holdReasons({ status: "ACTIVE", bankVerified: false })).toEqual(["Bank account not verified"]));
  it("lists both", () => expect(holdReasons({ status: "SUSPENDED", bankVerified: false })).toHaveLength(2));
});

describe("scopeNote: says whose data this is", () => {
  it("whole programme for everyone", () => expect(scopeNote({ kind: "all" }, "ADMIN")).toMatch(/whole programme/i));
  it("a partner sees their network, with a count", () => expect(scopeNote({ kind: "ids", ids: ["a", "b", "c"], detailIds: [] }, "DISTRIBUTOR")).toMatch(/your network.*3 partners/i));
  it("singular", () => expect(scopeNote({ kind: "ids", ids: ["a"], detailIds: [] }, "PARTNER")).toMatch(/1 partner\b/));
  it("a team manager sees their team's partners", () => expect(scopeNote({ kind: "ids", ids: ["a", "b"], detailIds: [] }, "TEAM_MANAGER")).toMatch(/your team/i));
  it("empty scope says nothing is assigned", () => expect(scopeNote({ kind: "ids", ids: [], detailIds: [] }, "PARTNER")).toMatch(/no partners/i));
});

describe("buildNativeOverviewVM", () => {
  const summary: Summary = {
    referrers: { total: 10, active: 6, pending: 2, suspended: 1, terminated: 1 },
    referees: { total: 40, active: 25 },
    earnings: { lastMonth: 1000, lastMonthLabel: "Sep 2026", total: 5000 },
    monthly: [{ period: "2026-08", earnings: 400, referees: null }, { period: "2026-09", earnings: 1000, referees: null }],
    topReferrers: [{ id: "p1", fullName: "Asha Associates", referralCode: "PTR-00001", refereeCount: 12, earningsTotal: 3000 }],
  };
  const extras = { hiddenRuns: 0, accrualsThisMonth: { count: 7, amount: 250.5, label: "Oct 2026" }, pendingPayouts: { count: 3, amount: 900 }, openRuns: 2, tierMix: [{ tier: "GOLD", count: 3 }, { tier: "SILVER", count: 1 }] };

  it("builds the money tiles with the period named", () => {
    const vm = buildNativeOverviewVM(summary, extras);
    const by = Object.fromEntries(vm.tiles.map((t) => [t.key, t]));
    expect(by.earnings).toMatchObject({ value: 5000, format: "inr" });
    expect(by.accruals).toMatchObject({ value: 250.5, hint: "7 accruals in Oct 2026" });
    expect(by.pending).toMatchObject({ value: 900, hint: "3 payouts to release" });
    expect(by.referred).toMatchObject({ value: 40, format: "number", hint: "25 with an active account" });
  });
  it("says one accrual and one payout in the singular", () => {
    const vm = buildNativeOverviewVM(summary, { ...extras, accrualsThisMonth: { count: 1, amount: 1, label: "Oct 2026" }, pendingPayouts: { count: 1, amount: 1 } });
    expect(vm.tiles.find((t) => t.key === "accruals")!.hint).toBe("1 accrual in Oct 2026");
    expect(vm.tiles.find((t) => t.key === "pending")!.hint).toBe("1 payout to release");
  });
  it("tier mix widths add up to 100 and every tier has its count", () => {
    const vm = buildNativeOverviewVM(summary, extras);
    expect(vm.tierMix.segments.map((s) => [s.tier, s.count, s.percent])).toEqual([["GOLD", 3, 75], ["SILVER", 1, 25]]);
    expect(vm.tierMix.segments.reduce((n, s) => n + s.percent, 0)).toBe(100);
    expect(vm.tierMix.total).toBe(4);
  });
  it("keeps percentages summing to exactly 100 with awkward counts", () => {
    const vm = buildNativeOverviewVM(summary, { ...extras, tierMix: [{ tier: "GOLD", count: 1 }, { tier: "SILVER", count: 1 }, { tier: "BRONZE", count: 1 }] });
    expect(vm.tierMix.segments.reduce((n, s) => n + s.percent, 0)).toBe(100);
  });
  it("an empty tier mix has no segments, not a divide by zero", () => {
    const vm = buildNativeOverviewVM(summary, { ...extras, tierMix: [] });
    expect(vm.tierMix.segments).toEqual([]);
    expect(vm.tierMix.total).toBe(0);
  });
  it("lists the empanelment mix and the top partners with their links", () => {
    const vm = buildNativeOverviewVM(summary, extras);
    expect(vm.statusMix.map((s) => [s.label, s.count])).toEqual([["Active", 6], ["Onboarding", 2], ["Suspended", 1], ["Terminated", 1]]);
    expect(vm.top[0]).toMatchObject({ name: "Asha Associates", href: "/partners/affiliates/p1" });
  });
  it("shows open payout runs only to someone who can see them", () => {
    expect(buildNativeOverviewVM(summary, extras).openRuns).toBe(2);
    expect(buildNativeOverviewVM(summary, { ...extras, openRuns: null }).openRuns).toBeNull();
  });
  it("is empty when there is nothing at all", () => {
    const vm = buildNativeOverviewVM({ ...summary, referrers: { total: 0, active: 0, pending: 0, suspended: 0, terminated: 0 }, referees: { total: 0, active: 0 }, topReferrers: [] }, { ...extras, tierMix: [] });
    expect(vm.isEmpty).toBe(true);
  });
});

describe("buildPartnerListVM", () => {
  it("shows name, code, tier, status, masked bank, counts and money", () => {
    const vm = buildPartnerListVM(page([partner()], 1), q());
    expect(vm.rows[0]).toMatchObject({ name: "Asha Associates", code: "PTR-00001", href: "/partners/affiliates/p1", referred: 12, earned: "₹12,345.50" });
    expect(vm.rows[0].tier).toEqual({ label: "Gold", tone: "default" });
    expect(vm.rows[0].status).toEqual({ label: "Active", tone: "success" });
    expect(vm.rows[0].bank).toEqual({ label: "Verified", tail: "•••• 4321", tone: "success" });
  });
  it("links to a parent only when one is visible", () => {
    const vm = buildPartnerListVM(page([partner({ parent: { id: "p0", code: "PTR-00000", name: "Top Dist" } }), partner({ id: "p2" })], 2), q());
    expect(vm.rows[0].parent).toEqual({ name: "Top Dist", href: "/partners/affiliates/p0" });
    expect(vm.rows[1].parent).toBeNull();
  });
  it("builds filter chips that keep the others and reset paging", () => {
    const vm = buildPartnerListVM(page([partner()], 60, 25), q({ status: "ACTIVE", tier: "GOLD", q: "ash", offset: "25" }));
    expect(vm.statusChips.find((c) => c.key === "SUSPENDED")!.href).toBe("/partners/affiliates?q=ash&status=SUSPENDED&tier=GOLD");
    expect(vm.statusChips.find((c) => c.key === "ACTIVE")!.active).toBe(true);
    expect(vm.tierChips.find((c) => c.key === "all")!.href).toBe("/partners/affiliates?q=ash&status=ACTIVE");
  });
  it("pages with next and previous links that keep the filters", () => {
    const vm = buildPartnerListVM(page([partner()], 60, 25), q({ status: "ACTIVE", offset: "25" }));
    expect(vm.prevHref).toBe("/partners/affiliates?status=ACTIVE");
    expect(vm.nextHref).toBe("/partners/affiliates?offset=50&status=ACTIVE");
    expect(vm.pagination).toMatchObject({ from: 26, to: 26, total: 60 });
  });
  it("tells an empty filter from an empty programme and a page past the end", () => {
    expect(buildPartnerListVM(page([], 0), q()).emptyReason).toBe("none");
    expect(buildPartnerListVM(page([], 0), q({ q: "zzz" })).emptyReason).toBe("filtered");
    expect(buildPartnerListVM(page([], 5, 100), q({ offset: "100" })).emptyReason).toBe("out_of_range");
  });
});

describe("buildNetworkVM", () => {
  const row = (o: Partial<NetworkRow>): NetworkRow => ({ id: "a", code: "PTR-1", name: "A", tier: "GOLD", status: "ACTIVE", depth: 0, childCount: 0, truncated: false, own: 100, override: 0, rollup: 100, referred: 1, ...o });
  it("indents by depth and shows own and roll-up money separately", () => {
    const vm = buildNetworkVM({ ...page([row({ childCount: 2, rollup: 300 }), row({ id: "b", depth: 1, own: 150, rollup: 150 })], 2), capped: false }, q());
    expect(vm.rows[0]).toMatchObject({ depth: 0, indent: 0, own: "₹100", rollup: "₹300", hasChildren: true });
    expect(vm.rows[1]).toMatchObject({ depth: 1, indent: 20 });
  });
  it("caps the indent so a deep tree stays readable on a phone", () => {
    const vm = buildNetworkVM({ ...page([row({ depth: 11 })], 1), capped: false }, q());
    expect(vm.rows[0].indent).toBeLessThanOrEqual(120);
  });
  it("warns when the list was cut at the safety limit and when a branch is hidden by depth", () => {
    const vm = buildNetworkVM({ ...page([row({ truncated: true })], 1), capped: true }, q());
    expect(vm.capped).toBe(true);
    expect(vm.rows[0].truncated).toBe(true);
  });
});

describe("buildReferredVM", () => {
  const r = (o: Partial<ReferredRow> = {}): ReferredRow => ({ clientId: "c1", clientCode: "CL-00001", name: "Priya S.", via: "ACCOUNT", funnel: "ACTIVE", stage: "Onboarded", source: "Web", since: "2026-09-02T00:00:00.000Z", partner: { id: "p1", code: "PTR-00001", name: "Asha Associates" }, ...o });
  it("distinguishes a client from a lead and links the partner", () => {
    const vm = buildReferredVM(page([r(), r({ via: "LEAD", funnel: "LEAD", clientId: "c2", clientCode: "CL-00002" })], 2), q());
    expect(vm.rows[0]).toMatchObject({ kind: { label: "Client", tone: "success" }, stage: { label: "Active", tone: "success" }, partnerHref: "/partners/affiliates/p1", name: "Priya S." });
    expect(vm.rows[1].kind).toEqual({ label: "Lead", tone: "warning" });
    expect(vm.rows[1].stage).toEqual({ label: "Lead", tone: "warning" });
  });
  it("has segment and stage chips that keep the search", () => {
    const vm = buildReferredVM(page([r()], 1), q({ q: "cl", segment: "leads" }));
    expect(vm.segmentChips.map((c) => [c.key, c.active])).toEqual([["all", false], ["clients", false], ["leads", true]]);
    expect(vm.segmentChips.find((c) => c.key === "clients")!.href).toBe("/partners/referred-users?q=cl&segment=clients");
    expect(vm.funnelChips.find((c) => c.key === "CLOSED")!.href).toBe("/partners/referred-users?funnel=CLOSED&q=cl&segment=leads");
  });
  it("filters to one partner and says so", () => {
    const vm = buildReferredVM(page([r()], 1), q({ partner: "p1" }));
    expect(vm.partnerFilter).toEqual({ id: "p1", clearHref: "/partners/referred-users" });
  });
});

describe("buildCommissionsVM", () => {
  const c = (o: Partial<CommissionRow> = {}): CommissionRow => ({
    id: "a1",
    date: "2026-09-05T05:00:00.000Z",
    status: "ACCRUED",
    partner: { id: "p1", code: "PTR-00001", name: "Asha Associates" },
    clientCode: "CL-00001",
    revenueType: "BROKERAGE",
    gross: "10000",
    amount: "150",
    override: null,
    explain: { storedAmount: "150", grossRevenue: "10000", revenueType: "BROKERAGE", eventDate: "2026-09-05T05:00:00.000Z", computationVersion: "v1", planName: "Standard", rule: { rateType: "PERCENT_OF_GROSS", percentRate: "1.5", flatRate: null, productCategory: null, transactionType: null, validFrom: "2026-01-01T00:00:00.000Z", validTo: null, slabs: [] } },
    ...o,
  });
  it("carries the working of each accrual", () => {
    const vm = buildCommissionsVM({ ...page([c()], 1), total: 1 }, q());
    expect(vm.rows[0].amount).toBe("₹150");
    expect(vm.rows[0].gross).toBe("₹10,000");
    expect(vm.rows[0].explanation.headline).toBe("1.5% of gross revenue 10000.00 = 150.00");
    expect(vm.rows[0].explanation.matches).toBe(true);
    expect(vm.rows[0].status).toEqual({ label: "Accrued", tone: "default" });
  });
  it("shows a negative accrual (a reversal) as such", () => {
    const vm = buildCommissionsVM({ ...page([c({ amount: "-40", gross: "-2666.67", explain: { ...c().explain, storedAmount: "-40", grossRevenue: "-2666.67" } })], 1), total: 1 }, q());
    expect(vm.rows[0].amount).toBe("-₹40");
  });
  it("status chips keep the search", () => {
    const vm = buildCommissionsVM({ ...page([c()], 1), total: 1 }, q({ q: "cl-1" }));
    expect(vm.statusChips.find((x) => x.key === "REVERSED")!.href).toBe("/partners/commissions?accrual=REVERSED&q=cl-1");
  });
});

describe("buildPayoutsVM", () => {
  const p = (o: Partial<PayoutRow> = {}): PayoutRow => ({ id: "py1", runId: "r1", runStart: "2026-08-31T18:30:00.000Z", runEnd: "2026-09-30T18:30:00.000Z", runStatus: "APPROVED", partner: { id: "p1", code: "PTR-00001", name: "Asha Associates" }, accrued: "154.99995", adjustment: "-10", net: "144.99995", status: "APPROVED", externalRef: null, reconciledAt: null, lines: 2, empanelment: "ACTIVE", bankVerified: true, bankLast4: "4321", ...o });
  it("labels the period in India dates and rounds to paise once", () => {
    const vm = buildPayoutsVM({ view: "payouts", payouts: page([p()], 1) }, q());
    expect(vm.payouts!.rows[0]).toMatchObject({ period: "1 to 30 Sep 2026", accrued: "₹155", adjustment: "-₹10", net: "₹145", statementHref: "/partners/statements/p1?run=r1" });
    expect(vm.payouts!.rows[0].status).toEqual({ label: "Approved", tone: "success" });
  });
  it("flags a payout that would be held, from the partner's status and bank", () => {
    const vm = buildPayoutsVM({ view: "payouts", payouts: page([p({ empanelment: "SUSPENDED", bankVerified: false, bankLast4: null })], 1) }, q());
    expect(vm.payouts!.rows[0].holds).toEqual(["Partner is suspended", "Bank account not verified"]);
    expect(vm.payouts!.holdNote).toMatch(/blocks approval/i);
    expect(vm.payouts!.rows[0].bank.tail).toBeNull();
  });
  it("names an external reference and a reconciled payout", () => {
    const vm = buildPayoutsVM({ view: "payouts", payouts: page([p({ status: "RECONCILED_EXTERNALLY", externalRef: "UTR-9", reconciledAt: "2026-10-03T00:00:00.000Z" })], 1) }, q());
    expect(vm.payouts!.rows[0]).toMatchObject({ externalRef: "UTR-9", reconciled: "3 Oct 2026" });
    expect(vm.payouts!.rows[0].status.label).toBe("Reconciled outside");
  });
  it("runs view lists the runs with a link into their payouts", () => {
    const vm = buildPayoutsVM({ view: "runs", runs: page([{ id: "r1", start: "2026-08-31T18:30:00.000Z", end: "2026-09-30T18:30:00.000Z", status: "FINALIZED", approvedAt: "2026-10-01T00:00:00.000Z", finalizedAt: null, payouts: 3, total: 1234.5 }], 1) }, q());
    expect(vm.runs!.rows[0]).toMatchObject({ period: "1 to 30 Sep 2026", total: "₹1,234.50", href: "/partners/payouts?run=r1&view=payouts", payouts: 3 });
    expect(vm.runs!.rows[0].status).toEqual({ label: "Finalized", tone: "success" });
  });
  it("says how many draft runs are awaiting approval without listing them", () => {
    const runs = (hidden?: number) => ({ ...page([], 0), hiddenRuns: hidden });
    expect(buildPayoutsVM({ view: "runs", runs: runs(2) }, q()).runs!.hiddenNote).toBe("2 payout runs awaiting approval. You see a run once it is submitted for approval.");
    expect(buildPayoutsVM({ view: "runs", runs: runs(1) }, q()).runs!.hiddenNote).toMatch(/^1 payout run awaiting approval/);
    expect(buildPayoutsVM({ view: "runs", runs: runs(0) }, q()).runs!.hiddenNote).toBeNull();
    expect(buildPayoutsVM({ view: "runs", runs: runs(undefined) }, q()).runs!.hiddenNote).toBeNull();
  });
  it("has the view switch and payout status chips", () => {
    const vm = buildPayoutsVM({ view: "payouts", payouts: page([p()], 1) }, q({ status: "APPROVED" }));
    expect(vm.viewChips.map((c) => [c.key, c.active])).toEqual([["runs", false], ["payouts", true]]);
    expect(vm.statusChips!.find((c) => c.key === "APPROVED")!.active).toBe(true);
  });
});

describe("buildStatementVM", () => {
  const data = (o: Partial<StatementData> = {}): StatementData => ({
    partner: { id: "p1", code: "PTR-00001", name: "Asha Associates", type: "PARTNER", tier: "GOLD", status: "ACTIVE", bankLast4: "4321", bankVerifiedAt: "2026-08-01T00:00:00.000Z" },
    period: { kind: "run", start: "2026-08-31T18:30:00.000Z", end: "2026-09-30T18:30:00.000Z", key: "r1" },
    run: { id: "r1", status: "APPROVED" },
    payout: { id: "py1", status: "APPROVED", externalRef: null, reconciledAt: null, totalAccrual: "30", adjustment: "-5", net: "25" },
    lines: Array.from({ length: 30 }, (_, i) => ({ id: `l${String(i).padStart(2, "0")}`, date: `2026-09-${String(i + 1).padStart(2, "0")}T05:00:00.000Z`, revenueType: "BROKERAGE", clientCode: "CL-00001", amount: "1" })),
    adjustments: [{ id: "x1", date: "2026-09-20T05:00:00.000Z", reason: "Clawback", amount: "-5" }],
    detail: "full",
    aggregate: null,
    tax: null,
    cumulative: null,
    ...o,
  });
  it("totals every line, but shows one page of them", () => {
    const vm = buildStatementVM(data(), { offset: 0, pageSize: 25 });
    expect(vm.totals).toMatchObject({ gross: "₹30", adjustments: "-₹5", net: "₹25", rounding: "₹0" });
    expect(vm.lines.rows).toHaveLength(25);
    expect(vm.lines.pagination).toMatchObject({ from: 1, to: 25, total: 30 });
    expect(vm.lines.nextOffset).toBe(25);
  });
  it("the second page has the rest and a way back", () => {
    const vm = buildStatementVM(data(), { offset: 25, pageSize: 25 });
    expect(vm.lines.rows).toHaveLength(5);
    expect(vm.lines.nextOffset).toBeNull();
    expect(vm.lines.prevOffset).toBe(0);
  });
  it("the print version shows every line", () => {
    expect(buildStatementVM(data(), { all: true }).lines.rows).toHaveLength(30);
  });
  it("names the period, the status of the run and payout, and a bank tail that is only four digits", () => {
    const vm = buildStatementVM(data(), { offset: 0, pageSize: 25 });
    expect(vm.periodLabel).toBe("1 Sep 2026 to 30 Sep 2026");
    expect(vm.runStatus).toEqual({ label: "Approved", tone: "success" });
    expect(vm.payoutStatus).toEqual({ label: "Approved", tone: "success" });
    expect(vm.bank).toEqual({ label: "Verified", tail: "•••• 4321", tone: "success" });
  });
  it("checks the working against the stored payout and says when they disagree", () => {
    expect(buildStatementVM(data(), { all: true }).check).toEqual({ matches: true, message: null });
    const off = buildStatementVM(data({ payout: { id: "py1", status: "APPROVED", externalRef: null, reconciledAt: null, totalAccrual: "30", adjustment: "-5", net: "20" } }), { all: true });
    expect(off.check.matches).toBe(false);
    expect(off.check.message).toMatch(/differs from the stored payout/i);
  });
  it("the open statement is labelled as an estimate with no payout", () => {
    const vm = buildStatementVM(data({ period: { kind: "open", start: null, end: null, key: "open" }, run: null, payout: null, adjustments: [] }), { all: true });
    expect(vm.periodLabel).toBe("Accruals not yet in a payout run");
    expect(vm.isEstimate).toBe(true);
    expect(vm.payoutStatus).toBeNull();
    expect(vm.check).toEqual({ matches: true, message: null });
  });
  it("builds the export links from the partner and the period", () => {
    const vm = buildStatementVM(data(), { all: true });
    expect(vm.csvHref).toBe("/partners/statements/p1/export?run=r1");
    expect(vm.printHref).toBe("/partner-statement/p1?run=r1");
  });
  it("lists the assumptions, including that no tax is computed", () => {
    expect(buildStatementVM(data(), { all: true }).assumptions.join(" ")).toMatch(/TDS/);
  });
});


const tdsRule = (over: Partial<TaxRule> = {}): TaxRule => ({ id: "t1", kind: "TDS", label: "Section X", ratePercent: "10", thresholdAmount: null, partnerTypes: [], panStatus: "ANY", gstRegistration: "ANY", gstMode: null, effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null, ...over });
const baseData = (o: Partial<StatementData> = {}): StatementData => ({
  partner: { id: "p1", code: "PTR-00001", name: "Asha Associates", type: "PARTNER", tier: "GOLD", status: "ACTIVE", bankLast4: "4321", bankVerifiedAt: "2026-08-01T00:00:00.000Z" },
  period: { kind: "run", start: "2026-08-31T18:30:00.000Z", end: "2026-09-30T18:30:00.000Z", key: "r1" },
  run: { id: "r1", status: "APPROVED" },
  payout: { id: "py1", status: "APPROVED", externalRef: null, reconciledAt: null, totalAccrual: "2000", adjustment: "0", net: "2000" },
  lines: [{ id: "l1", date: "2026-09-05T05:00:00.000Z", revenueType: "BROKERAGE", clientCode: "CL-00001", amount: "2000" }],
  adjustments: [],
  detail: "full",
  aggregate: null,
  tax: null,
  cumulative: null,
  ...o,
});
const withTax = (rules: TaxRule[], priorBase = "0") => ({ rules, facts: { partnerType: "PARTNER", hasPan: true, hasGstin: false }, at: "2026-09-30T18:29:59.999Z", priorBase });

describe("buildStatementVM: tax", () => {
  it("says plainly that no tax rules are configured, and deducts nothing", () => {
    const vm = buildStatementVM(baseData({ tax: withTax([]) }), { all: true });
    expect(vm.tax).toMatchObject({ state: "not_configured", lines: [] });
    expect(vm.tax!.message).toMatch(/no tax rules are configured/i);
    expect(vm.tax!.message).toMatch(/nothing is deducted/i);
    expect(vm.totals.payable).toBe("₹2,000");
  });
  it("shows each tax line with the exact rule, the rounding rule, the Finance note and the payable after tax", () => {
    const vm = buildStatementVM(baseData({ tax: withTax([tdsRule()]) }), { all: true });
    expect(vm.tax!.state).toBe("applied");
    expect(vm.tax!.lines[0]).toMatchObject({ kindLabel: "TDS", label: "Section X", rate: "10%", amount: "₹200", effect: "-₹200", memo: false });
    expect(vm.tax!.lines[0].ruleText).toContain("Section X");
    expect(vm.tax!.note).toBe("Tax rules are configured by Finance. Confirm with your tax adviser.");
    expect(vm.tax!.rounding).toMatch(/nearest paisa/i);
    expect(vm.totals).toMatchObject({ net: "₹2,000", payable: "₹1,800", payableValue: 1800 });
  });
  it("a reverse-charge GST line is shown as a memo that does not change what is paid", () => {
    const gst = tdsRule({ id: "g", kind: "GST", label: "GST", ratePercent: "18", gstMode: "REVERSE_CHARGE" });
    const vm = buildStatementVM(baseData({ tax: withTax([gst]) }), { all: true });
    expect(vm.tax!.lines[0]).toMatchObject({ kindLabel: "GST", memo: true, amount: "₹360", effect: "₹0" });
    expect(vm.totals.payable).toBe("₹2,000");
  });
  it("rules that do not cover the partner, and rules in conflict, are said as such", () => {
    expect(buildStatementVM(baseData({ tax: withTax([tdsRule({ partnerTypes: ["DISTRIBUTOR"] })]) }), { all: true }).tax!.message).toMatch(/none of them applies to this partner/i);
    const c = buildStatementVM(baseData({ tax: withTax([tdsRule({ id: "a" }), tdsRule({ id: "b" })]) }), { all: true });
    expect(c.tax!.state).toBe("conflict");
    expect(c.tax!.message).toMatch(/conflict/i);
  });
  it("an open estimate shows no tax at all and says where tax appears", () => {
    const vm = buildStatementVM(baseData({ period: { kind: "open", start: null, end: null, key: "open" }, run: null, payout: null }), { all: true });
    expect(vm.tax).toBeNull();
    expect(vm.taxNote).toMatch(/payout run, month and year statements/i);
  });
  it("the payable is carried to the CSV and print links", () => {
    const vm = buildStatementVM(baseData({ tax: withTax([tdsRule()]) }), { all: true });
    expect(vm.statement.payable).toBe("1800.00");
  });
});

describe("buildStatementVM: totals only", () => {
  const hidden = baseData({ detail: "totals", lines: [], adjustments: [], aggregate: { accruals: "2000", adjustments: "-50" }, tax: null });
  it("shows exact totals and no line, no adjustment and no tax", () => {
    const vm = buildStatementVM(hidden, { all: true });
    expect(vm.detailHidden).toBe(true);
    expect(vm.lines.rows).toEqual([]);
    expect(vm.adjustments).toEqual([]);
    expect(vm.tax).toBeNull();
    expect(vm.taxNote).toBe("Tax is not shown on a statement you see as totals only.");
    expect(vm.totals).toMatchObject({ gross: "₹2,000", adjustments: "-₹50", net: "₹1,950" });
    expect(vm.detailNote).toMatch(/totals only/i);
  });
  it("cannot be queried: there is no line to question", () => {
    expect(buildStatementVM(hidden, { all: true }, { canQuery: true }).canQuery).toBe(false);
  });
});

describe("buildStatementVM: months, financial years and queries", () => {
  it("labels a calendar month, a financial year and the year to date", () => {
    const m = buildStatementVM(baseData({ period: { kind: "month", start: "2026-08-31T18:30:00.000Z", end: "2026-09-30T18:30:00.000Z", key: "m-2026-09" }, run: null, payout: null, tax: withTax([]) }), { all: true });
    expect(m.periodLabel).toBe("Sep 2026");
    expect(m.kindLabel).toBe("Calendar month");
    const fy = buildStatementVM(baseData({ period: { kind: "fy", start: "2026-03-31T18:30:00.000Z", end: "2027-03-31T18:30:00.000Z", key: "fy-2026-27" }, run: null, payout: null, tax: withTax([]) }), { all: true });
    expect(fy.periodLabel).toBe("FY 2026-27 (Apr 2026 to Mar 2027)");
    expect(fy.kindLabel).toBe("Financial year");
    expect(m.isEstimate).toBe(false);
  });
  it("builds export links that carry the period key", () => {
    const vm = buildStatementVM(baseData({ period: { kind: "month", start: "2026-08-31T18:30:00.000Z", end: "2026-09-30T18:30:00.000Z", key: "m-2026-09" }, run: null, payout: null, tax: withTax([]) }), { all: true });
    expect(vm.csvHref).toBe("/partners/statements/p1/export?run=m-2026-09");
    expect(vm.printHref).toBe("/partner-statement/p1?run=m-2026-09");
  });
  it("the year to date is a month-by-month table with a running total and tax carried month by month", () => {
    const vm = buildStatementVM(
      baseData({ period: { kind: "fyc", start: "2026-03-31T18:30:00.000Z", end: "2027-03-31T18:30:00.000Z", key: "fyc-2026-27" }, run: null, payout: null, lines: [], tax: withTax([tdsRule({ thresholdAmount: "1000" })]), cumulative: { priorBase: "0", months: [{ key: "2026-04", accruals: "600", adjustments: "0" }, { key: "2026-05", accruals: "600", adjustments: "0" }] } }),
      { all: true },
    );
    expect(vm.kindLabel).toBe("Financial year to date");
    expect(vm.cumulative!.rows.map((r) => [r.monthLabel, r.base, r.running, r.tds])).toEqual([["Apr 2026", "₹600", "₹600", "₹0"], ["May 2026", "₹600", "₹1,200", "₹120"]]);
    expect(vm.cumulative!.totals).toMatchObject({ base: "₹1,200", tds: "₹120" });
    expect(vm.cumulative!.note).toBe("Tax rules are configured by Finance. Confirm with your tax adviser.");
  });
  it("each line can be queried when the viewer is allowed, and only then", () => {
    const yes = buildStatementVM(baseData(), { all: true }, { canQuery: true });
    expect(yes.canQuery).toBe(true);
    expect(yes.lines.rows[0].queryRef).toBe("l1");
    expect(buildStatementVM(baseData(), { all: true }).canQuery).toBe(false);
  });
  it("an override line shows its own label and no customer code", () => {
    const vm = buildStatementVM(baseData({ lines: [{ id: "o1", date: "2026-09-05T05:00:00.000Z", revenueType: "OVERRIDE", clientCode: null, amount: "50", label: "Override, level 1" }] }), { all: true });
    expect(vm.lines.rows[0]).toMatchObject({ type: "Override, level 1", clientCode: "—" });
  });
  it("carries the letterhead and registration text for the print version", () => {
    const vm = buildStatementVM(baseData(), { all: true }, { branding: { letterhead: ["Firm", "Town"], registration: "Registered no. 123" } });
    expect(vm.branding).toEqual({ letterhead: ["Firm", "Town"], registration: "Registered no. 123" });
    expect(buildStatementVM(baseData(), { all: true }).branding).toEqual({ letterhead: [], registration: "" });
  });
});

describe("overview, referred, commissions, network and runs: hidden things are counted, not listed", () => {
  it("the overview says how many payout runs are awaiting approval without listing them", () => {
    expect(buildNativeOverviewVM(summaryFixture(), { ...extrasFixture(), hiddenRuns: 2 }).runsNote).toBe("2 payout runs awaiting approval. You see a run once it is submitted for approval.");
    expect(buildNativeOverviewVM(summaryFixture(), { ...extrasFixture(), hiddenRuns: 1 }).runsNote).toMatch(/^1 payout run awaiting approval/);
    expect(buildNativeOverviewVM(summaryFixture(), { ...extrasFixture(), hiddenRuns: 0 }).runsNote).toBeNull();
  });
  it("referred: sub-partners' people are a count for a partner, and a team manager gets no people at all", () => {
    const r = { clientId: "c1", clientCode: "CL-1", name: "P S.", via: "ACCOUNT" as const, funnel: "ACTIVE", stage: "x", source: null, since: "2026-09-02T00:00:00.000Z", partner: { id: "p1", code: "PTR-1", name: "A" } };
    expect(buildReferredVM({ ...page([r], 1), hidden: 3 }, q(), "partner").hiddenNote).toBe("Plus 3 people referred by your sub-partners. You see counts only, not who they are.");
    expect(buildReferredVM({ ...page([r], 1), hidden: 1 }, q(), "partner").hiddenNote).toMatch(/^Plus 1 person referred by your sub-partners/);
    expect(buildReferredVM({ ...page([], 0), hidden: 4 }, q(), "team").hiddenNote).toBe("4 people referred by your team's partners. Team managers see counts and totals, not individual people.");
    expect(buildReferredVM({ ...page([r], 1), hidden: 0 }, q(), "all").hiddenNote).toBeNull();
  });
  it("commissions: the rest of the scope is one exact aggregate line, and an override row says so", () => {
    const row: CommissionRow = { id: "a1", date: "2026-09-05T05:00:00.000Z", status: "ACCRUED", partner: { id: "p1", code: "PTR-1", name: "A" }, clientCode: null, revenueType: "OVERRIDE", gross: "0", amount: "50", override: { level: 1, ratePercent: "5", capPerAccrual: null }, explain: { storedAmount: "50", grossRevenue: "0", revenueType: "OVERRIDE", eventDate: "2026-09-05T05:00:00.000Z", computationVersion: "override-v1", planName: null, rule: null, override: { level: 1, ratePercent: "5", capPerAccrual: null, sourceAmount: null } } };
    const vm = buildCommissionsVM({ ...page([row], 1), total: 1, others: { count: 4, amount: "105" } }, q(), "partner");
    expect(vm.others).toBe("Your sub-partners' 4 accruals add up to ₹105. You see totals only, not the individual accruals.");
    expect(vm.rows[0]).toMatchObject({ isOverride: true, type: "Override, level 1", clientCode: "—", gross: "—" });
    expect(buildCommissionsVM({ ...page([], 0), total: 0, others: { count: 5, amount: "420" } }, q(), "team").others).toBe("Your team's partners have 5 accruals adding up to ₹420. Team managers see totals, not individual accruals.");
    expect(buildCommissionsVM({ ...page([row], 1), total: 1, others: null }, q(), "all").others).toBeNull();
  });
  it("network: the override column appears only once some partner has override earnings", () => {
    const row = (o: Partial<NetworkRow>): NetworkRow => ({ id: "a", code: "PTR-1", name: "A", tier: "GOLD", status: "ACTIVE", depth: 0, childCount: 0, truncated: false, own: 100, override: 0, rollup: 100, referred: 1, ...o });
    expect(buildNetworkVM({ ...page([row({})], 1), capped: false }, q()).showOverride).toBe(false);
    const vm = buildNetworkVM({ ...page([row({ override: 4 })], 1), capped: false }, q());
    expect(vm.showOverride).toBe(true);
    expect(vm.rows[0].override).toBe("₹4");
  });
});

describe("buildPeriodIndexVM: statements by month and by financial year", () => {
  const now = new Date("2026-10-10T06:00:00Z");
  const rows = { items: [{ partner: { id: "p1", code: "PTR-1", name: "A" }, count: 2, total: "340", detail: true }, { partner: { id: "p2", code: "PTR-2", name: "B" }, count: 1, total: "80", detail: false }], total: 2, limit: 25, offset: 0 };
  it("lists the partners with their totals and links to each statement", () => {
    const vm = buildPeriodIndexVM(rows, { kind: "month", key: "2026-09" }, q(), now);
    expect(vm.rows[0]).toMatchObject({ partnerCode: "PTR-1", count: 2, total: "₹340", href: "/partners/statements/p1?run=m-2026-09", csvHref: "/partners/statements/p1/export?run=m-2026-09" });
    expect(vm.title).toBe("Sep 2026");
  });
  it("a financial year also links the year to date, for tax filing", () => {
    const vm = buildPeriodIndexVM(rows, { kind: "fy", key: "2026-27" }, q(), now);
    expect(vm.rows[0]).toMatchObject({ href: "/partners/statements/p1?run=fy-2026-27", cumulativeHref: "/partners/statements/p1?run=fyc-2026-27" });
    expect(vm.title).toBe("FY 2026-27 (Apr 2026 to Mar 2027)");
  });
  it("offers the latest months or years as links, with the current one marked", () => {
    const vm = buildPeriodIndexVM(rows, { kind: "month", key: "2026-09" }, q(), now);
    expect(vm.choices).toHaveLength(12);
    expect(vm.choices.find((c) => c.active)!.label).toBe("Sep 2026");
    expect(vm.choices[vm.choices.length - 1].label).toBe("Oct 2026");
    const fy = buildPeriodIndexVM(rows, { kind: "fy", key: "2026-27" }, q(), now);
    expect(fy.choices.map((c) => c.key)).toEqual(["2023-24", "2024-25", "2025-26", "2026-27"]);
  });
  it("a partner whose lines the viewer cannot see is marked totals only", () => {
    expect(buildPeriodIndexVM(rows, { kind: "month", key: "2026-09" }, q(), now).rows[1].totalsOnly).toBe(true);
  });
});

function summaryFixture() {
  return { referrers: { total: 4, active: 3, pending: 1, suspended: 0, terminated: 0 }, referees: { total: 9, active: 5 }, earnings: { lastMonth: 1000, lastMonthLabel: "Sep 2026", total: 5000 }, monthly: [{ period: "2026-09", earnings: 1000, referees: null }], topReferrers: [] };
}
function extrasFixture() {
  return { hiddenRuns: 0, accrualsThisMonth: { count: 2, amount: 250, label: "Oct 2026" }, pendingPayouts: { count: 1, amount: 900 }, openRuns: 1, tierMix: [{ tier: "GOLD", count: 3 }] };
}
