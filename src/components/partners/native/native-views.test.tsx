import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { buildStatement } from "@/lib/partners/native/statement";
import { parseNativeQuery } from "@/lib/partners/native/query";
import {
  buildAdjustmentsVM,
  buildCommissionsVM,
  buildNativeOverviewVM,
  buildNetworkVM,
  buildPartnerListVM,
  buildPayoutsVM,
  buildReferredVM,
  buildStatementIndexVM,
  buildStatementVM,
} from "@/lib/partners/native/view-models";
import type { CommissionRow, PartnerRow, PayoutRow, ReferredRow, StatementData } from "@/lib/partners/native/queries";
import { formatInr } from "@/lib/partners/view-models";
import { LoadGate } from "../states";
import { NativeAffiliatesView } from "./affiliates";
import { NativeAdjustmentsView, NativeCommissionsView } from "./commissions";
import { NativeNetworkView } from "./network";
import { NativeOverviewView } from "./overview";
import { NativePayoutsView } from "./payouts";
import { PrintableStatement } from "./print-document";
import { NativeReferredView } from "./referred";
import { NativeStatementsView, NativeStatementView } from "./statements";

const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const q = (sp: Record<string, string> = {}) => parseNativeQuery(sp);
const pg = <T,>(items: T[], total = items.length, offset = 0) => ({ items, total, limit: 25, offset });

const partner: PartnerRow = { id: "p1", code: "PTR-00001", name: "Asha Associates", type: "PARTNER", tier: "GOLD", status: "ACTIVE", empanelledOn: "2026-01-05T00:00:00.000Z", bankVerified: true, bankLast4: "4321", parent: null, referred: 12, earned: 12345.5, enrolled: "2026-01-01T00:00:00.000Z" };
const summary = { referrers: { total: 4, active: 3, pending: 1, suspended: 0, terminated: 0 }, referees: { total: 9, active: 5 }, earnings: { lastMonth: 1000, lastMonthLabel: "Sep 2026", total: 5000 }, monthly: [{ period: "2026-08", earnings: 400, referees: null }, { period: "2026-09", earnings: 1000, referees: null }], topReferrers: [{ id: "p1", fullName: "Asha Associates", referralCode: "PTR-00001", refereeCount: 12, earningsTotal: 3000 }] };
const extras = { accrualsThisMonth: { count: 2, amount: 250, label: "Oct 2026" }, pendingPayouts: { count: 1, amount: 900 }, openRuns: 1, tierMix: [{ tier: "GOLD", count: 3 }, { tier: "SILVER", count: 1 }] };

describe("LoadGate with a native result", () => {
  it("shows no contract warning and no sample banner", () => {
    const out = html(<LoadGate loaded={{ status: "ok", data: 1, sample: false, source: "native" }}>{() => <b>content</b>}</LoadGate>);
    expect(out).toContain("content");
    expect(out).not.toMatch(/contract|Sample data/i);
  });
});

describe("overview", () => {
  it("renders the money tiles, the tier mix with its accessible description, and the top partners", () => {
    const out = html(<NativeOverviewView vm={buildNativeOverviewVM(summary, extras)} />);
    expect(out).toContain("Earnings to date");
    expect(out).toContain("Accruals this month");
    expect(out).toContain("Pending payouts");
    expect(out).toContain("Partners by tier: Gold 3, Silver 1");
    expect(out).toContain("75%");
    expect(out).toContain("Top partners");
    expect(out).toContain('href="/partners/affiliates/p1"');
    expect(out).toContain("1 payout run is still open");
  });
  it("hides the open-run line from someone who cannot see runs", () => {
    expect(html(<NativeOverviewView vm={buildNativeOverviewVM(summary, { ...extras, openRuns: null })} />)).not.toContain("payout run");
  });
  it("says so when there are no partners", () => {
    const out = html(<NativeOverviewView vm={buildNativeOverviewVM({ ...summary, referrers: { total: 0, active: 0, pending: 0, suspended: 0, terminated: 0 } }, extras)} />);
    expect(out).toContain("No partners yet");
  });
});

describe("partners list", () => {
  it("shows the bank state with the last four digits and nothing more", () => {
    const out = html(<NativeAffiliatesView vm={buildPartnerListVM(pg([partner]), q())} />);
    expect(out).toContain("Verified");
    expect(out).toContain("•••• 4321");
    expect(out).toContain("Asha Associates");
    expect(out).not.toMatch(/\d{9,}/);
  });
});

describe("network", () => {
  it("indents children and shows the branch total", () => {
    const row = (o: object) => ({ id: "a", code: "PTR-1", name: "A", tier: "GOLD", status: "ACTIVE", depth: 0, childCount: 1, truncated: false, own: 100, rollup: 250, referred: 1, ...o });
    const out = html(<NativeNetworkView vm={buildNetworkVM({ ...pg([row({}), row({ id: "b", name: "B", depth: 1, childCount: 0, own: 150, rollup: 150 })]), capped: false }, q())} />);
    expect(out).toContain("padding-left:20px");
    expect(out).toContain("₹250");
    expect(out).toContain("1 direct");
  });
  it("warns when the list was cut", () => {
    expect(html(<NativeNetworkView vm={buildNetworkVM({ ...pg([]), capped: true }, q())} />)).toContain("only the first 5,000");
  });
});

describe("referred", () => {
  const r = (o: Partial<ReferredRow>): ReferredRow => ({ clientId: "c1", clientCode: "CL-00001", name: "Priya S.", via: "ACCOUNT", funnel: "ACTIVE", stage: "Onboarded", source: "Web", since: "2026-09-02T00:00:00.000Z", partner: { id: "p1", code: "PTR-00001", name: "Asha Associates" }, ...o });
  it("separates clients from leads and shows a masked name and a code, never contact details", () => {
    const out = html(<NativeReferredView vm={buildReferredVM(pg([r({}), r({ clientId: "c2", clientCode: "CL-00002", via: "LEAD", funnel: "LEAD" })]), q())} />);
    expect(out).toContain("Priya S.");
    expect(out).toContain(">Client<");
    expect(out).toContain(">Lead<");
    expect(out).not.toMatch(/@|\d{10}/);
  });
});

describe("commissions", () => {
  const c: CommissionRow = {
    id: "a1", date: "2026-09-05T05:00:00.000Z", status: "ACCRUED", partner: { id: "p1", code: "PTR-00001", name: "Asha Associates" }, clientCode: "CL-00001", revenueType: "BROKERAGE", gross: "10000", amount: "150",
    explain: { storedAmount: "150", grossRevenue: "10000", revenueType: "BROKERAGE", eventDate: "2026-09-05T05:00:00.000Z", computationVersion: "v1", planName: "Standard", rule: { rateType: "SLAB", percentRate: null, flatRate: null, productCategory: null, transactionType: null, validFrom: "2026-01-01T00:00:00.000Z", validTo: null, slabs: [{ minAmount: "0", maxAmount: "5000", rate: "1" }, { minAmount: "5000", maxAmount: null, rate: "1.5" }] } },
  };
  it("puts the working under each accrual in a disclosure, with the slab that applied", () => {
    const out = html(<NativeCommissionsView vm={buildCommissionsVM({ ...pg([c]), total: 1 }, q())} />);
    expect(out).toContain("<details");
    expect(out).toContain("How was this worked out?");
    expect(out).toContain("1.5% (slab 5000.00 and above) of gross revenue 10000.00 = 150.00");
    expect(out).toContain("₹150");
  });
  it("warns when the stored amount no longer agrees with the rule", () => {
    const out = html(<NativeCommissionsView vm={buildCommissionsVM({ ...pg([{ ...c, explain: { ...c.explain, storedAmount: "100" } }]), total: 1 }, q())} />);
    expect(out).toContain("differs from the rule as it stands now");
  });
  it("lists adjustments with their reason and whether a second person approved", () => {
    const vm = buildAdjustmentsVM(pg([{ id: "x", date: "2026-09-20T05:00:00.000Z", partner: { id: "p1", code: "PTR-00001", name: "Asha Associates" }, amount: "-10", reason: "Clawback", periodStart: "2026-08-31T18:30:00.000Z", periodEnd: "2026-09-30T18:30:00.000Z", approved: true }]), q({ view: "adjustments" }));
    const out = html(<NativeAdjustmentsView vm={vm} />);
    expect(out).toContain("Clawback");
    expect(out).toContain("-₹10");
    expect(out).toContain("Approved by a second person");
    expect(out).toContain("1 Sep 2026 to 30 Sep 2026");
  });
});

describe("payouts", () => {
  const p: PayoutRow = { id: "py1", runId: "r1", runStart: "2026-08-31T18:30:00.000Z", runEnd: "2026-09-30T18:30:00.000Z", runStatus: "APPROVED", partner: { id: "p1", code: "PTR-00001", name: "Asha Associates" }, accrued: "155", adjustment: "-10", net: "145", status: "APPROVED", externalRef: null, reconciledAt: null, lines: 2, empanelment: "SUSPENDED", bankVerified: false, bankLast4: null };
  it("shows empanelment, bank state and why a payout would be held", () => {
    const out = html(<NativePayoutsView vm={buildPayoutsVM({ view: "payouts", payouts: pg([p]) }, q({ view: "payouts" }))} />);
    expect(out).toContain("Suspended");
    expect(out).toContain("Not verified");
    expect(out).toContain("Partner is suspended. Bank account not verified");
    expect(out).toContain('href="/partners/statements/p1?run=r1"');
  });
  it("says it never moves money", () => {
    expect(html(<NativePayoutsView vm={buildPayoutsVM({ view: "runs", runs: pg([]) }, q())} />)).toContain("never moves money");
  });
});

describe("statements", () => {
  const data = (n: number): StatementData => ({
    partner: { id: "p1", code: "PTR-00001", name: "Asha Associates", type: "PARTNER", tier: "GOLD", status: "ACTIVE", bankLast4: "4321", bankVerifiedAt: "2026-08-01T00:00:00.000Z" },
    period: { kind: "run", start: "2026-08-31T18:30:00.000Z", end: "2026-09-30T18:30:00.000Z", key: "r1" },
    run: { id: "r1", status: "APPROVED" },
    payout: { id: "py1", status: "APPROVED", externalRef: "UTR-9", reconciledAt: null, totalAccrual: String(n), adjustment: "-5", net: String(n - 5) },
    lines: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, date: "2026-09-05T05:00:00.000Z", revenueType: "BROKERAGE", clientCode: "CL-00001", amount: "1" })),
    adjustments: [{ id: "x", date: "2026-09-20T05:00:00.000Z", reason: "Clawback", amount: "-5" }],
  });
  it("shows the totals with a rounding line, the assumptions, and the export links", () => {
    const vm = buildStatementVM(data(30), { offset: 0, pageSize: 25 });
    const out = html(<NativeStatementView vm={vm} pageHref={(o) => `/x?offset=${o}`} />);
    expect(out).toContain("Net payable");
    expect(out).toContain("Rounding");
    expect(out).toContain("TDS and GST are not calculated here");
    expect(out).toContain('href="/partners/statements/p1/export?run=r1"');
    expect(out).toContain('href="/partner-statement/p1?run=r1"');
    expect(out).toContain('href="/x?offset=25"');
    expect(out).toContain("1-25 of 30");
    expect(out).toContain("UTR-9");
    expect(out).toContain("•••• 4321");
  });
  it("export links are plain anchors, so opening one is never a prefetch", () => {
    const vm = buildStatementVM(data(3), { all: true });
    const out = html(<NativeStatementView vm={vm} pageHref={(o) => `/x?offset=${o}`} />);
    expect(out).not.toMatch(/<link[^>]+export/);
  });
  it("lists statements with CSV and print actions", () => {
    const row: PayoutRow = { id: "py1", runId: "r1", runStart: "2026-08-31T18:30:00.000Z", runEnd: "2026-09-30T18:30:00.000Z", runStatus: "APPROVED", partner: { id: "p1", code: "PTR-00001", name: "Asha Associates" }, accrued: "100", adjustment: "0", net: "100", status: "APPROVED", externalRef: null, reconciledAt: null, lines: 1, empanelment: "ACTIVE", bankVerified: true, bankLast4: "4321" };
    const out = html(<NativeStatementsView chips={[{ key: "runs", label: "By payout run", active: true, href: "/partners/statements" }]} index={buildStatementIndexVM(pg([row]), q())} />);
    expect(out).toContain("recorded in the audit log");
    expect(out).toContain('href="/partners/statements/p1/export?run=r1"');
    expect(out).toContain('href="/partner-statement/p1?run=r1"');
  });
  it("the print version carries every line and a generated stamp, with no app navigation", () => {
    const out = html(<PrintableStatement vm={buildStatementVM(data(30), { all: true })} generatedOn="10 Oct 2026, 11:30 IST" />);
    expect((out.match(/CL-00001/g) ?? []).length).toBe(30);
    expect(out).toContain("Generated 10 Oct 2026, 11:30 IST");
    expect(out).toContain("not a payment instruction");
    expect(out).not.toContain("<nav");
    expect(out).toContain("print:hidden");
  });
  it("is consistent with the maths module", () => {
    const d = data(3);
    const s = buildStatement({ lines: d.lines, adjustments: d.adjustments, stored: null });
    const vm = buildStatementVM(d, { all: true });
    expect(vm.totals.net).toBe(formatInr(Number(s.net)));
  });
});
