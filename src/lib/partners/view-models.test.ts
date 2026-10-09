import { describe, expect, it } from "vitest";
import { maskMobile } from "./mask";
import {
  KYC_FILTERS,
  buildAffiliateListVM,
  buildChartGeometry,
  buildOverviewVM,
  buildPayoutsVM,
  buildRefereesVM,
  buildReferrerDetailVM,
  formatInr,
  funnelBadge,
  kycBadge,
  pageWindow,
  partnersHref,
  referrerStatusBadge,
  withdrawalBadge,
} from "./view-models";
import { referrerSchema, summarySchema, refereeSchema, withdrawalPageSchema, referrerDetailSchema } from "./schemas";

describe("maskMobile", () => {
  it("keeps only the last four digits", () => {
    expect(maskMobile("+919812345678")).toBe("••••••5678");
    expect(maskMobile("98123 45678")).toBe("••••••5678");
  });
  it("never reveals short or missing values", () => {
    expect(maskMobile(null)).toBe("—");
    expect(maskMobile("")).toBe("—");
    expect(maskMobile("123")).toBe("••••");
  });
});

describe("formatInr", () => {
  it("formats with Indian grouping and trims empty paise", () => {
    expect(formatInr(1520.5)).toBe("₹1,520.50");
    expect(formatInr(1234567)).toBe("₹12,34,567");
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(-40)).toBe("-₹40");
  });
});

describe("badges", () => {
  it("colours KYC states and accepts the old affiliate vocabulary", () => {
    expect(kycBadge("Accepted")).toEqual({ label: "Verified", tone: "success" });
    expect(kycBadge("Approved").tone).toBe("success");
    expect(kycBadge("Pending Verification").tone).toBe("warning");
    expect(kycBadge("Pending").tone).toBe("warning");
    expect(kycBadge("Need_info").label).toBe("Needs info");
    expect(kycBadge("ReKYC").tone).toBe("warning");
    expect(kycBadge("Rejected").tone).toBe("destructive");
    expect(kycBadge("Blocked").tone).toBe("destructive");
    expect(kycBadge(null)).toEqual({ label: "Unknown", tone: "default" });
    expect(kycBadge("Brand New")).toEqual({ label: "Brand New", tone: "default" });
  });
  it("labels referrer, funnel and withdrawal statuses", () => {
    expect(referrerStatusBadge("ACTIVE")).toEqual({ label: "Active", tone: "success" });
    expect(referrerStatusBadge("ELIGIBILITY_PENDING").tone).toBe("warning");
    expect(referrerStatusBadge("SUSPENDED").tone).toBe("destructive");
    expect(referrerStatusBadge("TERMINATED").tone).toBe("default");
    expect(referrerStatusBadge("WEIRD_NEW").label).toBe("Weird new");
    expect(funnelBadge("ACCOUNT_OPENED").tone).toBe("success");
    expect(funnelBadge("REJECTED").tone).toBe("destructive");
    expect(funnelBadge("DORMANT").tone).toBe("warning");
    expect(withdrawalBadge("PAID").tone).toBe("success");
    expect(withdrawalBadge("REQUESTED").tone).toBe("warning");
    expect(withdrawalBadge("FAILED").tone).toBe("destructive");
  });
});

describe("pagination helpers", () => {
  it("computes a window with prev/next offsets", () => {
    expect(pageWindow({ total: 95, limit: 25, offset: 25 })).toEqual({ page: 2, pages: 4, from: 26, to: 50, total: 95, prevOffset: 0, nextOffset: 50 });
    expect(pageWindow({ total: 95, limit: 25, offset: 75 })).toMatchObject({ page: 4, to: 95, nextOffset: null });
    expect(pageWindow({ total: 0, limit: 25, offset: 0 })).toMatchObject({ from: 0, to: 0, pages: 1, prevOffset: null, nextOffset: null });
  });
  it("builds hrefs that keep filters and drop empties", () => {
    expect(partnersHref("/partners/affiliates", { q: "asha", kyc: "all", offset: 0 }, { offset: 25 })).toBe("/partners/affiliates?q=asha&kyc=all&offset=25");
    expect(partnersHref("/partners/affiliates", { q: "", status: undefined }, {})).toBe("/partners/affiliates");
    expect(partnersHref("/partners/affiliates", { q: "x y&z" }, {})).toBe("/partners/affiliates?q=x+y%26z");
  });
  it("lists KYC filter chips with an All chip first", () => {
    expect(KYC_FILTERS[0]).toEqual({ key: "all", label: "All", value: undefined });
    expect(KYC_FILTERS.map((f) => f.key)).toEqual(["all", "verified", "pending", "needs-info", "rejected"]);
  });
});

const summary = summarySchema.parse({
  referrers: { total: 120, active: 80, pending: 30, suspended: 6, terminated: 4 },
  referees: { total: 940, active: 610 },
  earnings: { lastMonth: "184250.5", lastMonthLabel: "Sep 2026" },
  monthly: [
    { period: "2026-07", earnings: 100, referees: 40 },
    { period: "2026-08", earnings: 150, referees: 55 },
    { period: "2026-09", earnings: 200, referees: 61 },
  ],
  topReferrers: [
    { id: 1, fullName: "A One", referralCode: "REF_AAAAAA", refereeCount: 40, earningsTotal: 5000 },
    { id: 2, fullName: "B Two", referralCode: "REF_BBBBBB", refereeCount: 30, earningsTotal: 3000 },
  ],
});

describe("buildOverviewVM", () => {
  it("builds the six KPI tiles with raw numbers for count-up", () => {
    const vm = buildOverviewVM(summary);
    expect(vm.kpis.map((k) => k.key)).toEqual(["affiliates", "pending", "approved", "referred", "active", "earnings"]);
    const by = Object.fromEntries(vm.kpis.map((k) => [k.key, k]));
    expect(by.affiliates.value).toBe(120);
    expect(by.pending.value).toBe(30);
    expect(by.approved.value).toBe(80);
    expect(by.referred.value).toBe(940);
    expect(by.active.value).toBe(610);
    expect(by.earnings).toMatchObject({ value: 184250.5, format: "inr", hint: "Sep 2026" });
    expect(by.pending.tone).toBe("warning");
    expect(by.approved.tone).toBe("success");
  });
  it("shapes the chart and top table", () => {
    const vm = buildOverviewVM(summary);
    expect(vm.chart.points.map((p) => p.label)).toEqual(["Jul 26", "Aug 26", "Sep 26"]);
    expect(vm.chart.geometry.line.startsWith("M")).toBe(true);
    expect(vm.top.map((t) => t.rank)).toEqual([1, 2]);
    expect(vm.top[0]).toMatchObject({ name: "A One", code: "REF_AAAAAA", referees: 40, earnings: "₹5,000" });
    expect(vm.isEmpty).toBe(false);
  });
  it("flags an empty programme", () => {
    expect(buildOverviewVM(summarySchema.parse({})).isEmpty).toBe(true);
  });
});

describe("buildChartGeometry", () => {
  it("scales to the max and keeps points inside the box", () => {
    const g = buildChartGeometry([0, 50, 100], { width: 300, height: 100, pad: 10 });
    expect(g.dots).toHaveLength(3);
    expect(g.dots[0]).toEqual({ x: 10, y: 90 });
    expect(g.dots[2]).toEqual({ x: 290, y: 10 });
    expect(g.area.endsWith("Z")).toBe(true);
  });
  it("survives all-zero and single-point series", () => {
    expect(buildChartGeometry([0, 0], { width: 100, height: 50, pad: 5 }).dots.every((d) => Number.isFinite(d.y))).toBe(true);
    expect(buildChartGeometry([5], { width: 100, height: 50, pad: 5 }).dots).toHaveLength(1);
    expect(buildChartGeometry([], { width: 100, height: 50, pad: 5 }).line).toBe("");
  });
});

const refRow = (o: Record<string, unknown> = {}) =>
  referrerSchema.parse({ id: 7, fullName: "Asha Verma", status: "ACTIVE", kycStatus: "Accepted", referralCode: "REF_AB12CD", mobile: "+919812345678", refereeCount: 12, earningsTotal: 1520.5, enrolledAt: "2026-08-01T10:00:00Z", ...o });

describe("buildAffiliateListVM", () => {
  const page = { items: [refRow(), refRow({ id: 8, fullName: "No Code", referralCode: null, mobile: null, kycStatus: "Rejected", status: "SUSPENDED" })], total: 52, limit: 25, offset: 25 };
  const vm = buildAffiliateListVM(page, { q: "as", kyc: "pending" });
  it("masks mobile, badges statuses and links to detail", () => {
    expect(vm.rows[0]).toMatchObject({ id: "7", name: "Asha Verma", mobile: "••••••5678", code: "REF_AB12CD", href: "/partners/affiliates/7", earnings: "₹1,520.50", referees: 12 });
    expect(vm.rows[0].kyc).toEqual({ label: "Verified", tone: "success" });
    expect(vm.rows[1]).toMatchObject({ code: null, mobile: "—" });
    expect(vm.rows[1].kyc.tone).toBe("destructive");
    expect(JSON.stringify(vm)).not.toContain("9812345678");
  });
  it("carries filter chips with the active one marked, and pagination links", () => {
    expect(vm.chips.find((c) => c.active)?.key).toBe("pending");
    expect(vm.chips[0].href).toBe("/partners/affiliates?q=as");
    expect(vm.pagination).toMatchObject({ page: 2, pages: 3, from: 26, to: 50 });
    expect(vm.prevHref).toBe("/partners/affiliates?q=as&kyc=pending");
    expect(vm.nextHref).toBe("/partners/affiliates?q=as&kyc=pending&offset=50");
  });
  it("says why a list is empty", () => {
    expect(buildAffiliateListVM({ items: [], total: 0, limit: 25, offset: 0 }, {}).emptyReason).toBe("none");
    expect(buildAffiliateListVM({ items: [], total: 0, limit: 25, offset: 0 }, { q: "zz" }).emptyReason).toBe("filtered");
    expect(vm.emptyReason).toBeNull();
  });
});

describe("buildReferrerDetailVM", () => {
  const detail = referrerDetailSchema.parse({
    id: 7, fullName: "Asha Verma", status: "SUSPENDED", suspensionReason: "KYC_LAPSED", kycStatus: "ReKYC", referralCode: "REF_AB12CD", mobile: "+919812345678", clientCode: "C100",
    wallet: { available: "100", onHold: 20 }, payouts: { requested: 1, paid: 3, paidTotal: 900, lastPaidAt: "2026-09-02T00:00:00Z" },
    activity: [{ at: "2026-09-01T00:00:00Z", action: "REFERRER_STATUS_CHANGE", label: null }, { at: "2026-09-05T00:00:00Z", action: "AGREEMENT_REACCEPTED", label: "Agreement re-accepted" }],
    enrolledAt: "2026-08-01T10:00:00Z",
  });
  const referees = { items: [refereeSchema.parse({ id: 1, displayName: "R. K.", funnelStatus: "ACCOUNT_OPENED", signedUpAt: "2026-08-10T00:00:00Z" })], total: 1, limit: 10, offset: 0 };
  const vm = buildReferrerDetailVM(detail, referees);
  it("shows profile, masked mobile, status reason and never PAN or bank", () => {
    expect(vm.name).toBe("Asha Verma");
    expect(vm.mobile).toBe("••••••5678");
    expect(vm.status.tone).toBe("destructive");
    expect(vm.statusNote).toBe("Suspended: KYC lapsed");
    expect(vm.kyc.label).toBe("Needs re-KYC");
    expect(vm.facts.find((f) => f.label === "Client code")?.value).toBe("C100");
    expect(JSON.stringify(vm).toLowerCase()).not.toMatch(/pan|bank|ifsc|9812345678/);
  });
  it("summarises earnings and payouts", () => {
    expect(vm.money.map((m) => [m.label, m.value])).toEqual([["Available", "₹100"], ["On hold", "₹20"], ["Paid out", "₹900"]]);
    expect(vm.payoutLine).toBe("3 paid, 1 open");
  });
  it("orders activity newest first with readable fallbacks", () => {
    expect(vm.activity.map((a) => a.label)).toEqual(["Agreement re-accepted", "Referrer status change"]);
  });
  it("lists referred users", () => {
    expect(vm.referees.rows).toHaveLength(1);
    expect(vm.referees.rows[0].funnel.label).toBe("Account opened");
  });
});

describe("buildRefereesVM", () => {
  const page = { items: [refereeSchema.parse({ id: 1, displayName: null, referrerId: 7, referrerName: "Asha", attributionStatus: "ATTRIBUTED", funnelStatus: "DORMANT", kycStatus: "Accepted", signupChannel: "GOOGLE", signedUpAt: "2026-08-10T00:00:00Z", clientCode: "C9" })], total: 1, limit: 25, offset: 0 };
  it("maps rows and falls back for a missing name", () => {
    const vm = buildRefereesVM(page, {});
    expect(vm.rows[0]).toMatchObject({ name: "Referred user", referrer: "Asha", referrerHref: "/partners/affiliates/7", channel: "Google" });
    expect(vm.rows[0].funnel.tone).toBe("warning");
    expect(vm.funnelChips[0].key).toBe("all");
  });
});

describe("buildPayoutsVM", () => {
  const page = withdrawalPageSchema.parse({
    items: [{ id: 1, withdrawalRef: "WD-1", referrerId: 7, referrerName: "Asha", status: "REQUESTED", amount: "500", requestedAt: "2026-10-01T00:00:00Z" }, { id: 2, status: "PAID", amount: 250, netAmount: 225, tdsAmount: 25, paidAt: "2026-10-02T00:00:00Z" }],
    total: 2,
    summary: { byStatus: { REQUESTED: { count: 1, amount: 500 }, PAID: { count: 1, amount: 250 } } },
  });
  it("totals by status and maps rows without any bank data", () => {
    const vm = buildPayoutsVM(page, {});
    expect(vm.totals.map((t) => [t.key, t.count, t.amount])).toEqual([["REQUESTED", 1, "₹500"], ["PAID", 1, "₹250"]]);
    expect(vm.rows[0]).toMatchObject({ ref: "WD-1", amount: "₹500", referrer: "Asha" });
    expect(vm.rows[1]).toMatchObject({ ref: "—", net: "₹225", tds: "₹25" });
    expect(JSON.stringify(vm).toLowerCase()).not.toMatch(/bank|ifsc/);
  });
  it("derives totals from the rows when the server sends no summary", () => {
    const vm = buildPayoutsVM({ ...page, summary: undefined }, {});
    expect(vm.totals.find((t) => t.key === "REQUESTED")?.count).toBe(1);
  });
});
