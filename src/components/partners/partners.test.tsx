import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createMockReferralApi } from "@/lib/partners/mock-data";
import { refereePageSchema, referrerPageSchema, summarySchema } from "@/lib/partners/schemas";
import { buildAffiliateListVM, buildOverviewVM, buildPayoutsVM, buildRefereesVM, buildReferrerDetailVM } from "@/lib/partners/view-models";
import { CopyCodeButton } from "./copy-code-button";
import { PerformanceChart } from "./performance-chart";
import { ErrorState, ListSkeleton, LoadGate, NotConnected, OverviewSkeleton, SampleBanner } from "./states";
import { AffiliateDetailView, AffiliatesView, OverviewView, PayoutsView, RefereesView } from "./views";

const api = createMockReferralApi();
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("states", () => {
  it("says sample data is switched off, with no link to any integration setting", () => {
    const out = html(<NotConnected />);
    expect(out).toContain("Sample data is switched off");
    expect(out).not.toMatch(/referral api|settings\/integrations/i);
  });
  it("renders errors as an alert with plain copy and nothing internal", () => {
    for (const kind of ["server", "not_found", "not_configured"] as const) {
      const out = html(<ErrorState kind={kind} />);
      expect(out).toContain('role="alert"');
      expect(out).not.toMatch(/stack|prisma|exception|Bearer|token/i);
    }
  });
  it("flags sample data", () => {
    expect(html(<SampleBanner />)).toContain("Sample data");
  });
  it("LoadGate renders the right state per result", () => {
    const ok = html(<LoadGate loaded={{ status: "ok", data: 5, sample: true, source: "sample" as const }}>{(n) => <b>value {n}</b>}</LoadGate>);
    expect(ok).toContain("value 5");
    expect(ok).toContain("Sample data");
    expect(ok).not.toMatch(/contract/i);
    expect(html(<LoadGate loaded={{ status: "not_connected" }}>{() => <b>never</b>}</LoadGate>)).not.toContain("never");
    expect(html(<LoadGate loaded={{ status: "error", kind: "server" }}>{() => <b>never</b>}</LoadGate>)).toContain("role=\"alert\"");
  });
  it("skeletons are busy and announce loading", () => {
    for (const s of [<OverviewSkeleton key="o" />, <ListSkeleton key="l" />]) {
      const out = html(s);
      expect(out).toContain('aria-busy="true"');
      expect(out).toContain("Loading");
    }
  });
});

describe("copy", () => {
  it("copy button is labelled and a dash when there is no code", () => {
    expect(html(<CopyCodeButton code="REF_AB12CD" />)).toContain('aria-label="Copy referral code REF_AB12CD"');
    expect(html(<CopyCodeButton code={null} />)).toContain("—");
  });
  it("can copy a referral link, and says so", () => {
    const out = html(<CopyCodeButton code="https://forms.example.test/join?ref=PTR-00001" what="referral link" />);
    expect(out).toContain('aria-label="Copy referral link https://forms.example.test/join?ref=PTR-00001"');
  });
});

describe("overview", async () => {
  const summary = await api.getSummary();
  const vm = buildOverviewVM(summary);
  it("renders the drawing chart and the top table; the six totals live in the rail", () => {
    const out = html(<OverviewView vm={vm} />);
    expect(out).toContain("data-chart-line");
    expect(out).toContain('role="img"');
    expect(out).toContain("Top affiliates");
    expect(out).toContain("Affiliate performance");
    expect(vm.kpis.map((k) => k.label)).toEqual(["Affiliates", "Pending (eligibility + agreement)", "Approved", "Referred users", "Active users", "Earnings last month"]);
  });
  it("chart has a text alternative table", () => {
    const out = html(<PerformanceChart chart={vm.chart} />);
    expect(out).toContain("<table>");
    expect(out).toContain("Earnings by month");
  });
  const minimal = { referrers: { total: 0 }, referees: { total: 0 }, earnings: { lastMonth: 0 }, monthly: [], topReferrers: [] };
  it("shows an empty state for a programme that reports zero", () => {
    expect(html(<OverviewView vm={buildOverviewVM(summarySchema.parse(minimal))} />)).toContain("No affiliates yet");
  });
  it("keeps counts the service did not report as null, so the rail shows a dash and never a zero", () => {
    const kpis = buildOverviewVM(summarySchema.parse({ ...minimal, referrers: { total: 4 } })).kpis;
    expect(kpis.find((k) => k.key === "pending")?.value).toBeNull();
    expect(kpis.find((k) => k.key === "pending")?.label).toBe("Pending (eligibility + agreement)");
  });
  it("shows an empty chart message with no months", () => {
    expect(html(<PerformanceChart chart={buildOverviewVM(summarySchema.parse({ ...minimal, referrers: { total: 1 } })).chart} />)).toContain("No monthly figures yet");
  });
});

describe("affiliates list", async () => {
  const page = await api.listReferrers({ limit: 10 });
  it("shows rows with masked mobiles, badges, chips and pager, and never a PAN-like value", () => {
    const out = html(<AffiliatesView vm={buildAffiliateListVM(page, { kyc: "pending" })} />);
    expect(out).toContain("••••••");
    expect(out).not.toMatch(/\+919000\d{6}/);
    expect(out).toContain('aria-current="true"');
    expect(out).toContain("Filter by KYC status");
    expect(out).toContain("Next");
    expect(out).toMatch(/Verified|Pending/);
    expect(out).not.toMatch(/[A-Z]{5}\d{4}[A-Z]/);
  });
  it("search box keeps the active KYC filter and caps length", () => {
    const out = html(<AffiliatesView vm={buildAffiliateListVM(page, { kyc: "pending", q: "as" })} q="as" />);
    expect(out).toContain('name="kyc" value="pending"');
    expect(out).toContain('maxLength="80"');
    expect(out).toContain('role="search"');
  });
  it("explains filtered and unfiltered empties", () => {
    const empty = referrerPageSchema.parse({ items: [], total: 0 });
    expect(html(<AffiliatesView vm={buildAffiliateListVM(empty, { q: "zz" })} />)).toContain("No affiliates match");
    expect(html(<AffiliatesView vm={buildAffiliateListVM(empty, {})} />)).toContain("No affiliates yet");
  });
  it("explains an offset past the end with a way back, and an unknown total honestly", () => {
    const past = referrerPageSchema.parse({ items: [], total: 30, limit: 25, offset: 100 });
    const out = html(<AffiliatesView vm={buildAffiliateListVM(past, {})} />);
    expect(out).toContain("past the end");
    expect(out).toContain("Back to the first page");
    const unknown = html(<AffiliatesView vm={buildAffiliateListVM({ ...page, total: null, limit: page.items.length }, {})} />);
    expect(unknown).toContain("total unknown");
    expect(unknown).not.toMatch(/of \d+/);
  });
  it("shows the whole-programme visibility line on the list", () => {
    expect(html(<AffiliatesView vm={buildAffiliateListVM(page, {})} />)).not.toContain("only your team");
  });
});

describe("affiliate detail", async () => {
  const first = (await api.listReferrers({ limit: 1 })).items[0];
  const detail = await api.getReferrer(first.id);
  const referees = await api.listReferees({ referrerId: first.id, limit: 10 });
  it("shows profile, KYC, code, money, activity and referred users", () => {
    const out = html(<AffiliateDetailView vm={buildReferrerDetailVM(detail, referees)} />);
    expect(out).toContain(first.fullName);
    expect(out).toContain("Referral code");
    expect(out).toContain("Activity");
    expect(out).toContain("Referred users (");
    expect(out.toLowerCase()).not.toMatch(/bank|ifsc|\bpan\b/);
  });
});

describe("referred users and payouts", async () => {
  it("renders the referred users list with stage chips", async () => {
    const out = html(<RefereesView vm={buildRefereesVM(await api.listReferees({ limit: 10 }), { funnel: "DORMANT" })} />);
    expect(out).toContain("Filter by stage");
    expect(out).toContain("Referred by");
  });
  it("empty referred users", () => {
    expect(html(<RefereesView vm={buildRefereesVM(refereePageSchema.parse({ items: [] }), {})} />)).toContain("No referred users yet");
  });
  it("labels no totals at all when the service sends no summary", async () => {
    const w = await api.listWithdrawals({ limit: 10 });
    const out = html(<PayoutsView vm={buildPayoutsVM({ ...w, summary: undefined }, {})} />);
    expect(out).not.toContain("Programme totals");
    expect(out).toContain("Totals are not available");
  });
  it("renders payouts read-only with programme totals and no bank column", async () => {
    const out = html(<PayoutsView vm={buildPayoutsVM(await api.listWithdrawals({ limit: 10 }), {})} />);
    expect(out).toContain("Programme totals");
    expect(out).toContain("Read-only");
    expect(out).toContain("TDS");
    expect(out.toLowerCase()).not.toMatch(/bank|ifsc|account number/);
    expect(out).not.toMatch(/<button[^>]*>(Approve|Reject|Pay)/);
  });
});
