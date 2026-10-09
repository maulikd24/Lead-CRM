import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createMockReferralApi } from "@/lib/partners/mock-data";
import { refereePageSchema, referrerPageSchema, summarySchema } from "@/lib/partners/schemas";
import { buildAffiliateListVM, buildOverviewVM, buildPayoutsVM, buildRefereesVM, buildReferrerDetailVM } from "@/lib/partners/view-models";
import { CopyCodeButton } from "./copy-code-button";
import { CountUp } from "./count-up";
import { PerformanceChart } from "./performance-chart";
import { ErrorState, ListSkeleton, LoadGate, NotConnected, OverviewSkeleton, SampleBanner } from "./states";
import { AffiliateDetailView, AffiliatesView, OverviewView, PayoutsView, RefereesView } from "./views";

const api = createMockReferralApi();
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("states", () => {
  it("shows the not-connected message with a Settings link only for admins", () => {
    const admin = html(<NotConnected canConfigure />);
    expect(admin).toContain("Not connected: ask an administrator to connect the referral API in Settings.");
    expect(admin).toContain('href="/settings/integrations"');
    expect(html(<NotConnected canConfigure={false} />)).not.toContain("/settings/integrations");
  });
  it("renders errors as an alert with plain copy and nothing internal", () => {
    for (const kind of ["server", "forbidden", "invalid_response", "network"] as const) {
      const out = html(<ErrorState kind={kind} />);
      expect(out).toContain('role="alert"');
      expect(out).not.toMatch(/stack|prisma|exception|Bearer|token/i);
    }
  });
  it("flags sample data", () => {
    expect(html(<SampleBanner />)).toContain("Sample data");
  });
  it("LoadGate renders the right state per result", () => {
    const ok = html(<LoadGate loaded={{ status: "ok", data: 5, sample: true }} canConfigure={false}>{(n) => <b>value {n}</b>}</LoadGate>);
    expect(ok).toContain("value 5");
    expect(ok).toContain("Sample data");
    expect(html(<LoadGate loaded={{ status: "ok", data: 5, sample: false }} canConfigure={false}>{(n) => <b>value {n}</b>}</LoadGate>)).not.toContain("Sample data");
    expect(html(<LoadGate loaded={{ status: "not_connected" }} canConfigure={false}>{() => <b>never</b>}</LoadGate>)).not.toContain("never");
    expect(html(<LoadGate loaded={{ status: "error", kind: "timeout" }} canConfigure={false}>{() => <b>never</b>}</LoadGate>)).toContain("role=\"alert\"");
  });
  it("skeletons are busy and announce loading", () => {
    for (const s of [<OverviewSkeleton key="o" />, <ListSkeleton key="l" />]) {
      const out = html(s);
      expect(out).toContain('aria-busy="true"');
      expect(out).toContain("Loading");
    }
  });
});

describe("count-up and copy", () => {
  it("server-renders the final value so no-JS and reduced-motion users see the real number", () => {
    expect(html(<CountUp value={1234567} />)).toContain("12,34,567");
    expect(html(<CountUp value={184250.5} format="inr" />)).toContain("₹1,84,250.50");
  });
  it("copy button is labelled and a dash when there is no code", () => {
    expect(html(<CopyCodeButton code="REF_AB12CD" />)).toContain('aria-label="Copy referral code REF_AB12CD"');
    expect(html(<CopyCodeButton code={null} />)).toContain("—");
  });
});

describe("overview", async () => {
  const summary = await api.getSummary();
  const vm = buildOverviewVM(summary);
  it("renders the six KPI tiles, the drawing chart and the top table", () => {
    const out = html(<OverviewView vm={vm} />);
    for (const label of ["Affiliates", "Pending approval", "Approved", "Referred users", "Active users", "Earnings last month"]) expect(out).toContain(label);
    expect(out).toContain("pw-line");
    expect(out).toContain('role="img"');
    expect(out).toContain("Top affiliates");
    expect(out).toContain("pw-rise");
  });
  it("chart has a text alternative table", () => {
    const out = html(<PerformanceChart chart={vm.chart} />);
    expect(out).toContain("<table>");
    expect(out).toContain("Earnings by month");
  });
  it("shows an empty state for an empty programme", () => {
    expect(html(<OverviewView vm={buildOverviewVM(summarySchema.parse({}))} />)).toContain("No affiliates yet");
  });
  it("shows an empty chart message with no months", () => {
    expect(html(<PerformanceChart chart={buildOverviewVM(summarySchema.parse({ referrers: { total: 1 } })).chart} />)).toContain("No monthly figures yet");
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
});

describe("affiliate detail", async () => {
  const first = (await api.listReferrers({ limit: 1 })).items[0];
  const detail = await api.getReferrer(first.id);
  const referees = await api.listReferees({ referrerId: first.id, limit: 10 });
  it("shows profile, KYC, code, money, activity and referred users", () => {
    const out = html(<AffiliateDetailView vm={buildReferrerDetailVM(detail, referees)} />);
    expect(out).toContain(first.fullName);
    expect(out).toContain("Referral code");
    expect(out).toContain("Earnings and payouts");
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
  it("renders payouts read-only with totals and no bank column", async () => {
    const out = html(<PayoutsView vm={buildPayoutsVM(await api.listWithdrawals({ limit: 10 }), {})} />);
    expect(out).toContain("Read-only");
    expect(out).toContain("TDS");
    expect(out.toLowerCase()).not.toMatch(/bank|ifsc|account number/);
    expect(out).not.toMatch(/<button[^>]*>(Approve|Reject|Pay)/);
  });
});
