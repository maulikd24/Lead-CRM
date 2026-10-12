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
  it("keeps the last four digits of a full-length number", () => {
    expect(maskMobile("+919812345678")).toBe("••••••5678");
    expect(maskMobile("98123 45678")).toBe("••••••5678");
  });
  it("keeps only the last two digits of a number shorter than ten digits", () => {
    expect(maskMobile("12345678")).toBe("••••••78");
    expect(maskMobile("123456789")).toBe("••••••89");
  });
  it("never reveals tiny or missing values", () => {
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

describe("badges are generic and call anything unrecognised Unknown", () => {
  it("colours KYC states", () => {
    expect(kycBadge("Accepted").tone).toBe("success");
    expect(kycBadge("Approved").tone).toBe("success");
    expect(kycBadge("Pending Verification")).toEqual({ label: "Pending verification", tone: "warning" });
    expect(kycBadge("Need_info").tone).toBe("warning");
    expect(kycBadge("Needs info")).toEqual({ label: "Needs info", tone: "warning" });
    expect(kycBadge("Rejected").tone).toBe("destructive");
    expect(kycBadge("Blocked").tone).toBe("destructive");
  });
  it("maps null and unrecognised values to Unknown with a neutral tone", () => {
    for (const f of [kycBadge, referrerStatusBadge, funnelBadge, withdrawalBadge]) {
      expect(f(null as never)).toEqual({ label: "Unknown", tone: "default" });
      expect(f("SOMETHING_NEW")).toEqual({ label: "Unknown", tone: "default" });
    }
  });
  it("colours the other status families by meaning", () => {
    expect(referrerStatusBadge("ACTIVE")).toEqual({ label: "Active", tone: "success" });
    expect(referrerStatusBadge("SUSPENDED").tone).toBe("destructive");
    expect(referrerStatusBadge("UNDER_REVIEW")).toEqual({ label: "Under review", tone: "warning" });
    expect(funnelBadge("DORMANT").tone).toBe("warning");
    expect(funnelBadge("ACCOUNT_OPENED").tone).toBe("success");
    expect(funnelBadge("REJECTED").tone).toBe("destructive");
    expect(withdrawalBadge("PAID").tone).toBe("success");
    expect(withdrawalBadge("REQUESTED").tone).toBe("warning");
    expect(withdrawalBadge("FAILED").tone).toBe("destructive");
    expect(withdrawalBadge("CANCELLED").tone).toBe("default");
  });
});

describe("pagination helpers", () => {
  it("computes a window with prev/next offsets for a known total", () => {
    expect(pageWindow({ total: 95, limit: 25, offset: 25, count: 25 })).toEqual({ page: 2, pages: 4, from: 26, to: 50, total: 95, totalKnown: true, prevOffset: 0, nextOffset: 50, outOfRange: false });
    expect(pageWindow({ total: 95, limit: 25, offset: 75, count: 20 })).toMatchObject({ page: 4, to: 95, nextOffset: null });
    expect(pageWindow({ total: 0, limit: 25, offset: 0, count: 0 })).toMatchObject({ from: 0, to: 0, pages: 1, prevOffset: null, nextOffset: null, outOfRange: false });
  });
  it("does not invent a total: unknown total keeps Next while a full page comes back", () => {
    const full = pageWindow({ total: null, limit: 25, offset: 0, count: 25 });
    expect(full).toMatchObject({ totalKnown: false, total: null, pages: null, from: 1, to: 25, nextOffset: 25 });
    const last = pageWindow({ total: null, limit: 25, offset: 25, count: 7 });
    expect(last).toMatchObject({ totalKnown: false, to: 32, nextOffset: null });
  });
  it("flags an offset past the end", () => {
    expect(pageWindow({ total: 30, limit: 25, offset: 100, count: 0 })).toMatchObject({ outOfRange: true, from: 0, to: 0, prevOffset: 75 });
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
  it("builds the six KPI tiles with raw numbers for count-up and an honest pending label", () => {
    const vm = buildOverviewVM(summary);
    expect(vm.kpis.map((k) => k.key)).toEqual(["affiliates", "pending", "approved", "referred", "active", "earnings"]);
    const by = Object.fromEntries(vm.kpis.map((k) => [k.key, k]));
    expect(by.affiliates.value).toBe(120);
    expect(by.pending.value).toBe(30);
    expect(by.pending.label).toBe("Pending (eligibility + agreement)");
    expect(by.approved.value).toBe(80);
    expect(by.referred.value).toBe(940);
    expect(by.active.value).toBe(610);
    expect(by.earnings).toMatchObject({ value: 184250.5, format: "inr", hint: "Sep 2026" });
  });
  it("shows an unreported optional count as a dash, never as 0", () => {
    const vm = buildOverviewVM(summarySchema.parse({ ...summaryInput(), referrers: { total: 5 }, referees: { total: 9 } }));
    const by = Object.fromEntries(vm.kpis.map((k) => [k.key, k]));
    expect(by.pending.value).toBeNull();
    expect(by.approved.value).toBeNull();
    expect(by.active.value).toBeNull();
    expect(by.approved.hint).toBeUndefined();
    expect(by.affiliates.value).toBe(5);
  });
  it("shapes the chart and top table", () => {
    const vm = buildOverviewVM(summary);
    expect(vm.chart.points.map((p) => p.label)).toEqual(["Jul 26", "Aug 26", "Sep 26"]);
    expect(vm.chart.geometry.line.startsWith("M")).toBe(true);
    expect(vm.top.map((t) => t.rank)).toEqual([1, 2]);
    expect(vm.top[0]).toMatchObject({ name: "A One", code: "REF_AAAAAA", referees: 40, earnings: "₹5,000" });
    expect(vm.isEmpty).toBe(false);
  });
  it("flags a programme that genuinely reports zero affiliates and zero referred users", () => {
    expect(buildOverviewVM(summarySchema.parse({ ...summaryInput(), referrers: { total: 0 }, referees: { total: 0 } })).isEmpty).toBe(true);
  });
});

function summaryInput() {
  return { referrers: { total: 1 }, referees: { total: 1 }, earnings: { lastMonth: 0 }, monthly: [], topReferrers: [] };
}

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
    expect(vm.rows[0].kyc.tone).toBe("success");
    expect(vm.rows[1]).toMatchObject({ code: null, mobile: "—" });
    expect(vm.rows[1].kyc.tone).toBe("destructive");
    expect(JSON.stringify(vm)).not.toContain("9812345678");
  });
  it("carries filter chips with the active one marked, and pagination links, ignoring a stale status param", () => {
    expect(vm.chips.find((c) => c.active)?.key).toBe("pending");
    expect(vm.chips[0].href).toBe("/partners/affiliates?q=as");
    expect(vm.pagination).toMatchObject({ page: 2, pages: 3, from: 26, to: 27 });
    expect(vm.prevHref).toBe("/partners/affiliates?q=as&kyc=pending");
    expect(vm.nextHref).toBe("/partners/affiliates?q=as&kyc=pending&offset=50");
    const withStatus = buildAffiliateListVM({ items: [], total: 0, limit: 25, offset: 0 }, { status: "PAID" });
    expect(withStatus.emptyReason).toBe("none");
  });
  it("says why a list is empty, including an offset past the end", () => {
    const empty = { items: [], total: 0, limit: 25, offset: 0 };
    expect(buildAffiliateListVM(empty, {}).emptyReason).toBe("none");
    expect(buildAffiliateListVM(empty, { q: "zz" }).emptyReason).toBe("filtered");
    const past = buildAffiliateListVM({ items: [], total: 30, limit: 25, offset: 100 }, { q: "a" });
    expect(past.emptyReason).toBe("out_of_range");
    expect(past.firstHref).toBe("/partners/affiliates?q=a");
    expect(vm.emptyReason).toBeNull();
  });
  it("with an unknown total keeps Next for a full page and says the total is unknown", () => {
    const rows = Array.from({ length: 25 }, (_, i) => refRow({ id: 100 + i }));
    const u = buildAffiliateListVM({ items: rows, total: null, limit: 25, offset: 0 }, {});
    expect(u.pagination.totalKnown).toBe(false);
    expect(u.nextHref).toBe("/partners/affiliates?offset=25");
  });
});

describe("buildReferrerDetailVM", () => {
  const detail = referrerDetailSchema.parse({
    id: 7, fullName: "Asha Verma", status: "SUSPENDED", suspensionReason: "COMPLIANCE_HOLD", kycStatus: "Needs info", referralCode: "REF_AB12CD", mobile: "+919812345678", clientCode: "C100", refereeCount: 7, earningsTotal: 900,
    wallet: { available: "100", onHold: 20 }, payouts: { requested: 1, paid: 3, paidTotal: 900, lastPaidAt: "2026-09-02T00:00:00Z" },
    activity: [{ at: "2026-09-01T00:00:00Z", action: "STATUS_CHANGED", label: null }, { at: "2026-09-05T00:00:00Z", action: "TERMS_ACCEPTED", label: "Agreement re-accepted" }, { at: "garbage", action: "X_Y", label: null }],
    enrolledAt: "2026-08-01T10:00:00Z",
  });
  const referees = { items: [refereeSchema.parse({ id: 1, displayName: "R. K.", funnelStatus: "ACCOUNT_OPENED", signedUpAt: "2026-08-10T00:00:00Z" })], total: 1, limit: 10, offset: 0 };
  const vm = buildReferrerDetailVM(detail, referees);
  it("shows profile, masked mobile, status reason and never PAN or bank", () => {
    expect(vm.name).toBe("Asha Verma");
    expect(vm.mobile).toBe("••••••5678");
    expect(vm.status.tone).toBe("destructive");
    expect(vm.statusNote).toBe("Reason: Compliance hold");
    expect(vm.kyc.label).toBe("Needs info");
    expect(vm.facts.find((f) => f.label === "Client code")?.value).toBe("C100");
    expect(JSON.stringify(vm).toLowerCase()).not.toMatch(/pan|bank|ifsc|9812345678/);
  });
  it("summarises earnings and payouts", () => {
    expect(vm.money.map((m) => [m.label, m.value])).toEqual([["Available", "₹100"], ["On hold", "₹20"], ["Paid out", "₹900"]]);
    expect(vm.payoutLine).toBe("3 paid, 1 open");
  });
  it("shows dashes, not zeros, when wallet and payouts are not reported", () => {
    const bare = buildReferrerDetailVM(referrerDetailSchema.parse({ id: 9, fullName: "B", status: "X", refereeCount: 0, earningsTotal: 0 }), { items: [], total: 0, limit: 10, offset: 0 });
    expect(bare.money.map((m) => m.value)).toEqual(["—", "—", "—"]);
    expect(bare.payoutLine).toBe("Payouts not reported");
  });
  it("orders activity newest first with readable fallbacks and survives a bad date", () => {
    expect(vm.activity.map((a) => a.label)).toEqual(["Agreement re-accepted", "Status changed", "X y"]);
    expect(vm.activity[2].at).toBe("—");
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
  const withSummary = withdrawalPageSchema.parse({
    items: [{ id: 1, withdrawalRef: "WD-1", referrerId: 7, referrerName: "Asha", status: "REQUESTED", amount: "500", requestedAt: "2026-10-01T00:00:00Z" }, { id: 2, status: "PAID", amount: 250, netAmount: 225, tdsAmount: 25, paidAt: "2026-10-02T00:00:00Z" }],
    total: 2,
    summary: { byStatus: { REQUESTED: { count: 1, amount: 500 }, PAID: { count: 1, amount: 250 } } },
  });
  it("shows programme totals by status only when the server supplies them", () => {
    const vm = buildPayoutsVM(withSummary, {});
    expect(vm.totalsSource).toBe("server");
    expect(vm.totals.map((t) => [t.key, t.count, t.amount])).toEqual([["REQUESTED", 1, "₹500"], ["PAID", 1, "₹250"]]);
    expect(vm.rows[0]).toMatchObject({ ref: "WD-1", amount: "₹500", referrer: "Asha" });
    expect(vm.rows[1]).toMatchObject({ ref: "—", net: "₹225", tds: "₹25" });
    expect(JSON.stringify(vm).toLowerCase()).not.toMatch(/bank|ifsc/);
  });
  it("never presents a page-level sum as a programme total when there is no summary", () => {
    const vm = buildPayoutsVM({ ...withSummary, summary: undefined }, {});
    expect(vm.totalsSource).toBe("none");
    expect(vm.totals).toEqual([]);
  });
});
