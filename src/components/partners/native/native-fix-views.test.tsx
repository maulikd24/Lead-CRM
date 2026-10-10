import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/(dashboard)/partners/statements/actions", () => ({ raiseStatementQueryAction: vi.fn() }));

import { parseNativeQuery } from "@/lib/partners/native/query";
import { buildCommissionsVM, buildNativeOverviewVM, buildNetworkVM, buildPayoutsVM, buildPeriodIndexVM, buildReferredVM, buildStatementVM } from "@/lib/partners/native/view-models";
import type { CommissionRow, StatementData } from "@/lib/partners/native/queries";
import type { TaxRule } from "@/lib/partners/tax/rules";
import { NativeCommissionsView } from "./commissions";
import { NativeNetworkView } from "./network";
import { NativeOverviewView } from "./overview";
import { NativePayoutsView } from "./payouts";
import { PrintableStatement } from "./print-document";
import { PHONE_ROWS, PhoneFold } from "./phone-fold";
import { NativeReferredView } from "./referred";
import { NativeStatementsView, NativeStatementView } from "./statements";

const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const q = (sp: Record<string, string> = {}) => parseNativeQuery(sp);
const pg = <T,>(items: T[], extra: object = {}) => ({ items, total: items.length, limit: 25, offset: 0, ...extra });

const tds: TaxRule = { id: "t1", kind: "TDS", label: "Section X", ratePercent: "10", thresholdAmount: null, partnerTypes: [], panStatus: "ANY", gstRegistration: "ANY", gstMode: null, effectiveFrom: "2026-04-01T00:00:00.000Z", effectiveTo: null };
const gst: TaxRule = { ...tds, id: "g1", kind: "GST", label: "GST", ratePercent: "18", gstMode: "REVERSE_CHARGE" };
const tax = (rules: TaxRule[]) => ({ rules, facts: { partnerType: "PARTNER", hasPan: true, hasGstin: false }, at: "2026-09-30T18:29:59.999Z", priorBase: "0" });
const data = (o: Partial<StatementData> = {}): StatementData => ({
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
const view = (d: StatementData, opts = {}) => html(<NativeStatementView vm={buildStatementVM(d, { offset: 0, pageSize: 25 }, opts)} pageHref={(o) => `/x?offset=${o}`} />);

describe("statement screen: tax", () => {
  it("with no tax rules it says so in words and shows no tax line", () => {
    const out = view(data({ tax: tax([]) }));
    expect(out).toContain("No tax rules are configured. Nothing is deducted.");
    expect(out).toContain("Tax rules are configured by Finance. Confirm with your tax adviser.");
    expect(out).not.toContain("Rule used:");
  });
  it("shows each tax line with the exact rule, the rounding rule and the payable after tax", () => {
    const out = view(data({ tax: tax([tds, gst]) }));
    expect(out).toContain("TDS: Section X");
    expect(out).toContain("Rule used:");
    expect(out).toContain("Section X: 10%");
    expect(out).toContain("GST: GST");
    expect(out).toContain("(shown, not deducted)");
    expect(out).toContain("nearest paisa");
    expect(out).toContain("Payable after tax");
    expect(out).toContain("₹1,800");
    expect(out).toContain("Net before tax");
  });
  it("an open estimate says where tax appears instead of showing any", () => {
    const out = view(data({ period: { kind: "open", start: null, end: null, key: "open" }, run: null, payout: null }));
    expect(out).toContain("Tax is shown on payout run, month and year statements");
  });
});

describe("statement screen: visibility and queries", () => {
  it("totals only: no line, no customer code, no tax, and a plain note", () => {
    const out = view(data({ detail: "totals", lines: [], aggregate: { accruals: "2000", adjustments: "0" } }));
    expect(out).toContain("Totals only");
    expect(out).not.toContain("CL-00001");
    expect(out).not.toContain(">Accruals</");
    expect(out).not.toContain("Rule used:");
  });
  it("offers 'Raise a query' on each line only when the viewer may", () => {
    expect(view(data(), { canQuery: true })).toContain("Raise a query about");
    expect(view(data())).not.toContain("Raise a query about");
  });
  it("labels an override line and never shows a customer code on it", () => {
    const out = view(data({ lines: [{ id: "o1", date: "2026-09-05T05:00:00.000Z", revenueType: "OVERRIDE", clientCode: null, amount: "50", label: "Override, level 1" }] }));
    expect(out).toContain("Override, level 1");
    expect(out).not.toContain("CL-");
  });
  it("keeps the export actions in a sticky bar on a phone and out of sight on a wider screen", () => {
    const out = view(data());
    expect(out).toMatch(/sticky bottom-0[^"]*sm:hidden/);
    expect(out).toContain("max-sm:hidden");
  });
});

describe("statement screen: financial year to date", () => {
  it("is a month by month table with the running total and tax, and the Finance note", () => {
    const out = view(
      data({ period: { kind: "fyc", start: "2026-03-31T18:30:00.000Z", end: "2027-03-31T18:30:00.000Z", key: "fyc-2026-27" }, run: null, payout: null, lines: [], adjustments: [], tax: tax([{ ...tds, thresholdAmount: "1000" }]), cumulative: { priorBase: "0", months: [{ key: "2026-04", accruals: "600", adjustments: "0" }, { key: "2026-05", accruals: "600", adjustments: "0" }] } }),
    );
    expect(out).toContain("Financial year to date");
    expect(out).toContain("Month by month");
    expect(out).toContain("Apr 2026");
    expect(out).toContain("₹1,200");
    expect(out).toContain("₹120");
    expect(out).toContain("Confirm with your tax adviser.");
  });
});

describe("statements index by month and year", () => {
  const rows = pg([{ partner: { id: "p1", code: "PTR-1", name: "A" }, count: 2, total: "340", detail: true }, { partner: { id: "p2", code: "PTR-2", name: "B" }, count: 1, total: "80", detail: false }]);
  const chips = [{ key: "month", label: "Calendar month", active: true, href: "/partners/statements?view=month" }];
  it("lists partners with their totals and links, and offers the year to date for a financial year", () => {
    const out = html(<NativeStatementsView chips={chips} period={buildPeriodIndexVM(rows, { kind: "fy", key: "2026-27" }, q(), new Date("2026-10-10T06:00:00Z"))} />);
    expect(out).toContain("FY 2026-27 (Apr 2026 to Mar 2027)");
    expect(out).toContain("Year to date");
    expect(out).toContain('href="/partners/statements/p1?run=fyc-2026-27"');
    expect(out).toContain("totals only");
    expect(out).toContain("₹340");
  });
  it("offers the latest months as links and marks the current one", () => {
    const out = html(<NativeStatementsView chips={chips} period={buildPeriodIndexVM(rows, { kind: "month", key: "2026-09" }, q(), new Date("2026-10-10T06:00:00Z"))} />);
    expect(out).toContain("Sep 2026");
    expect(out).toContain('aria-current="true"');
    expect(out).toContain("Choose a month");
  });
});

describe("hidden things are counted, not listed", () => {
  it("overview and runs say how many runs are awaiting approval", () => {
    const summary = { referrers: { total: 1, active: 1, pending: 0, suspended: 0, terminated: 0 }, referees: { total: 1, active: 1 }, earnings: { lastMonth: 1, lastMonthLabel: "Sep 2026", total: 1 }, monthly: [{ period: "2026-09", earnings: 1, referees: null }], topReferrers: [] };
    const extras = { hiddenRuns: 2, accrualsThisMonth: { count: 1, amount: 1, label: "Oct 2026" }, pendingPayouts: { count: 0, amount: 0 }, openRuns: null, tierMix: [{ tier: "GOLD", count: 1 }] };
    expect(html(<NativeOverviewView vm={buildNativeOverviewVM(summary, extras)} />)).toContain("2 payout runs awaiting approval");
    expect(html(<NativePayoutsView vm={buildPayoutsVM({ view: "runs", runs: pg([], { hiddenRuns: 1 }) }, q())} />)).toContain("1 payout run awaiting approval");
  });
  it("referred: sub-partners' people are a count; a team manager sees only the count", () => {
    const row = { clientId: "c1", clientCode: "CL-1", name: "P S.", via: "ACCOUNT" as const, funnel: "ACTIVE", stage: "x", source: null, since: "2026-09-02T00:00:00.000Z", partner: { id: "p1", code: "PTR-1", name: "A" } };
    expect(html(<NativeReferredView vm={buildReferredVM(pg([row], { hidden: 3 }), q(), "partner")} />)).toContain("Plus 3 people referred by your sub-partners");
    const tm = html(<NativeReferredView vm={buildReferredVM(pg([], { hidden: 4 }), q(), "team")} />);
    expect(tm).toContain("Team managers see counts and totals, not individual people.");
    expect(tm).not.toContain("<table");
  });
  it("commissions: an aggregate line for the rest, and an override row with its own label", () => {
    const row: CommissionRow = { id: "a1", date: "2026-09-05T05:00:00.000Z", status: "ACCRUED", partner: { id: "p1", code: "PTR-1", name: "A" }, clientCode: null, revenueType: "OVERRIDE", gross: "0", amount: "50", override: { level: 1, ratePercent: "5", capPerAccrual: null }, explain: { storedAmount: "50", grossRevenue: "0", revenueType: "OVERRIDE", eventDate: "2026-09-05T05:00:00.000Z", computationVersion: "override-v1", planName: null, rule: null, override: { level: 1, ratePercent: "5", capPerAccrual: null, sourceAmount: null } } };
    const out = html(<NativeCommissionsView vm={buildCommissionsVM({ ...pg([row]), total: 1, others: { count: 4, amount: "105" } }, q(), "partner")} />);
    expect(out).toContain("Your sub-partners&#x27; 4 accruals add up to ₹105");
    expect(out).toContain("Override, level 1");
    expect(out).not.toContain("sub-partner&#x27;s own figure is shown");
  });
  it("network: the override column shows only when someone has override earnings", () => {
    const row = (o: object) => ({ id: "a", code: "PTR-1", name: "A", tier: "GOLD", status: "ACTIVE", depth: 0, childCount: 0, truncated: false, own: 100, override: 0, rollup: 100, referred: 1, ...o });
    expect(html(<NativeNetworkView vm={buildNetworkVM({ ...pg([row({})]), capped: false }, q())} />)).not.toContain(">Override<");
    const out = html(<NativeNetworkView vm={buildNetworkVM({ ...pg([row({ override: 4 })]), capped: false }, q())} />);
    expect(out).toContain(">Override<");
    expect(out).toContain("₹4");
  });
});

describe("print version", () => {
  it("prints the letterhead and registration text from Settings above the figures, and the tax", () => {
    const vm = buildStatementVM(data({ tax: tax([tds]) }), { all: true }, { branding: { letterhead: ["Firm Name", "Town"], registration: "Registered no. 123" } });
    const out = html(<PrintableStatement vm={vm} generatedOn="10 Oct 2026, 11:30 IST" />);
    expect(out).toContain("Firm Name");
    expect(out).toContain("Registered no. 123");
    expect(out).toContain("Rule used:");
    expect(out).toContain("Confirm with your tax adviser.");
  });
  it("prints no issuer block when nothing is configured", () => {
    const out = html(<PrintableStatement vm={buildStatementVM(data({ tax: tax([]) }), { all: true })} generatedOn="x" />);
    expect(out).not.toContain("Registered");
    expect(out).toContain("No tax rules are configured");
  });
  it("totals only prints no line", () => {
    const out = html(<PrintableStatement vm={buildStatementVM(data({ detail: "totals", lines: [], aggregate: { accruals: "2000", adjustments: "0" } }), { all: true })} generatedOn="x" />);
    expect(out).not.toContain("CL-00001");
    expect(out).toContain("Totals only");
  });
});

describe("phone density: top five and View all", () => {
  it("shows a View all button only when there are more than five rows, and hides the sixth row on a phone", () => {
    const rows = Array.from({ length: PHONE_ROWS + 3 }, (_, i) => <tr key={i}><td>row {i}</td></tr>);
    const many = html(<PhoneFold count={rows.length} title="Rows"><table><tbody>{rows}</tbody></table></PhoneFold>);
    expect(many).toContain("View all 8");
    expect(many).toContain("max-sm:[&amp;_tbody&gt;tr:nth-child(n+6)]:hidden");
    const few = html(<PhoneFold count={3} title="Rows"><table><tbody>{rows.slice(0, 3)}</tbody></table></PhoneFold>);
    expect(few).not.toContain("View all");
  });
});
