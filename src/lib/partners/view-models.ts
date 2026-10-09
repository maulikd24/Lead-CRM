import { formatDate } from "@/lib/utils/format";
import { maskMobile } from "./mask";
import type { Page, Referee, Referrer, ReferrerDetail, Summary, Withdrawal, WithdrawalPage } from "./schemas";

/** Pure builders: API data in, display-ready view models out. No fetching, no React. */

export type Tone = "default" | "success" | "warning" | "destructive";
export type Badge = { label: string; tone: Tone };

const EM_DASH = "—";

export function humanize(raw: string): string {
  const s = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : EM_DASH;
}

export function formatInr(n: number): string {
  const abs = Math.abs(n);
  const whole = Number.isInteger(abs);
  const body = abs.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}₹${body}`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? EM_DASH : formatDate(d);
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

const KYC: Record<string, Badge> = {
  accepted: { label: "Verified", tone: "success" },
  approved: { label: "Verified", tone: "success" },
  verified: { label: "Verified", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  pendingverification: { label: "Pending", tone: "warning" },
  initiated: { label: "Pending", tone: "warning" },
  inactive: { label: "Not started", tone: "default" },
  rekyc: { label: "Needs re-KYC", tone: "warning" },
  needinfo: { label: "Needs info", tone: "warning" },
  rejected: { label: "Rejected", tone: "destructive" },
  blocked: { label: "Blocked", tone: "destructive" },
};
export function kycBadge(status: string | null | undefined): Badge {
  if (!status) return { label: "Unknown", tone: "default" };
  return KYC[norm(status)] ?? { label: status, tone: "default" };
}

const REFERRER_STATUS: Record<string, Badge> = {
  ACTIVE: { label: "Active", tone: "success" },
  ELIGIBILITY_PENDING: { label: "Awaiting KYC", tone: "warning" },
  AGREEMENT_PENDING: { label: "Agreement pending", tone: "warning" },
  SUSPENDED: { label: "Suspended", tone: "destructive" },
  TERMINATED: { label: "Terminated", tone: "default" },
};
export const referrerStatusBadge = (s: string): Badge => REFERRER_STATUS[s] ?? { label: humanize(s), tone: "default" };

const FUNNEL: Record<string, Badge> = {
  SIGNED_UP: { label: "Signed up", tone: "default" },
  KYC_IN_PROGRESS: { label: "KYC in progress", tone: "warning" },
  ACCOUNT_OPENED: { label: "Account opened", tone: "success" },
  ACTIVE: { label: "Active", tone: "success" },
  DORMANT: { label: "Dormant", tone: "warning" },
  REJECTED: { label: "Rejected", tone: "destructive" },
};
export const funnelBadge = (s: string): Badge => FUNNEL[s] ?? { label: humanize(s), tone: "default" };

const WITHDRAWAL: Record<string, Badge> = {
  REQUESTED: { label: "Requested", tone: "warning" },
  APPROVED: { label: "Approved", tone: "default" },
  PAID: { label: "Paid", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "default" },
  REJECTED: { label: "Rejected", tone: "destructive" },
  FAILED: { label: "Failed", tone: "destructive" },
};
export const withdrawalBadge = (s: string): Badge => WITHDRAWAL[s] ?? { label: humanize(s), tone: "default" };

/* ---------- pagination and links ---------- */

export function pageWindow({ total, limit, offset }: { total: number; limit: number; offset: number }) {
  const size = Math.max(1, limit);
  const pages = Math.max(1, Math.ceil(total / size));
  return {
    page: Math.floor(offset / size) + 1,
    pages,
    from: total === 0 ? 0 : offset + 1,
    to: total === 0 ? 0 : Math.min(total, offset + size),
    total,
    prevOffset: offset > 0 ? Math.max(0, offset - size) : null,
    nextOffset: offset + size < total ? offset + size : null,
  };
}

type Params = Record<string, string | number | undefined>;

/** Merges the current query with overrides (undefined removes a key) and drops empty values and a zero offset. */
export function partnersHref(path: string, current: Params, overrides: Params): string {
  const merged: Params = { ...current };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "" || (k === "offset" && Number(v) === 0)) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Filter chips: the key is what the page URL carries; the value is what the referral API's kycStatus filter accepts. */
export const KYC_FILTERS: { key: string; label: string; value: string | undefined }[] = [
  { key: "all", label: "All", value: undefined },
  { key: "verified", label: "Verified", value: "verified" },
  { key: "pending", label: "Pending", value: "pending" },
  { key: "needs-info", label: "Needs info", value: "needs_info" },
  { key: "rejected", label: "Rejected", value: "rejected" },
];

export const FUNNEL_FILTERS = ["all", "SIGNED_UP", "KYC_IN_PROGRESS", "ACCOUNT_OPENED", "ACTIVE", "DORMANT", "REJECTED"];
export const PAYOUT_FILTERS = ["all", "REQUESTED", "APPROVED", "PAID", "REJECTED", "CANCELLED", "FAILED"];

export type ListQuery = { q?: string; kyc?: string; status?: string; funnel?: string; offset?: number };

/* ---------- overview ---------- */

export type Kpi = { key: string; label: string; value: number; format: "number" | "inr"; tone: Tone; hint?: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function periodLabel(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return period;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1].slice(2)}`;
}

export function buildChartGeometry(values: number[], box: { width: number; height: number; pad: number }) {
  const { width, height, pad } = box;
  if (values.length === 0) return { line: "", area: "", dots: [] as { x: number; y: number }[], ticks: [] as { y: number; value: number }[], baseline: height - pad };
  const max = Math.max(...values, 0) || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const dots = values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * innerW,
    y: height - pad - (Math.max(0, v) / max) * innerH,
  }));
  const line = dots.map((d, i) => `${i === 0 ? "M" : "L"}${d.x} ${d.y}`).join(" ");
  const baseline = height - pad;
  const area = `${line} L${dots[dots.length - 1].x} ${baseline} L${dots[0].x} ${baseline} Z`;
  const ticks = [0, 1, 2, 3].map((i) => ({ y: baseline - (i / 3) * innerH, value: (max * i) / 3 }));
  return { line, area, dots, ticks, baseline };
}

export function buildOverviewVM(s: Summary) {
  const kpis: Kpi[] = [
    { key: "affiliates", label: "Affiliates", value: s.referrers.total, format: "number", tone: "default" },
    { key: "pending", label: "Pending approval", value: s.referrers.pending, format: "number", tone: "warning" },
    { key: "approved", label: "Approved", value: s.referrers.active, format: "number", tone: "success", hint: `of ${s.referrers.total}` },
    { key: "referred", label: "Referred users", value: s.referees.total, format: "number", tone: "default" },
    { key: "active", label: "Active users", value: s.referees.active, format: "number", tone: "success" },
    { key: "earnings", label: "Earnings last month", value: s.earnings.lastMonth, format: "inr", tone: "success", hint: s.earnings.lastMonthLabel ?? undefined },
  ];
  const points = s.monthly.map((m) => ({ label: periodLabel(m.period), earnings: m.earnings, referees: m.referees }));
  return {
    kpis,
    chart: { points, geometry: buildChartGeometry(points.map((p) => p.earnings), { width: 640, height: 240, pad: 28 }) },
    top: s.topReferrers.map((t, i) => ({
      rank: i + 1,
      id: t.id,
      name: t.fullName,
      code: t.referralCode,
      referees: t.refereeCount,
      earnings: formatInr(t.earningsTotal),
      href: `/partners/affiliates/${encodeURIComponent(t.id)}`,
    })),
    isEmpty: s.referrers.total === 0 && s.referees.total === 0,
  };
}

/* ---------- affiliates ---------- */

const AFFILIATES = "/partners/affiliates";

function refereeRow(r: Referee) {
  return {
    id: r.id,
    name: r.displayName ?? "Referred user",
    referrer: r.referrerName ?? EM_DASH,
    referrerHref: r.referrerId ? `${AFFILIATES}/${encodeURIComponent(r.referrerId)}` : null,
    channel: r.signupChannel ? humanize(r.signupChannel) : EM_DASH,
    funnel: funnelBadge(r.funnelStatus),
    kyc: kycBadge(r.kycStatus),
    signedUp: fmtDate(r.signedUpAt),
    clientCode: r.clientCode ?? EM_DASH,
  };
}

export function buildAffiliateListVM(page: Page<Referrer>, query: ListQuery) {
  const current: Params = { q: query.q, kyc: query.kyc, status: query.status };
  const w = pageWindow(page);
  const filtered = Boolean(query.q || (query.kyc && query.kyc !== "all") || query.status);
  return {
    rows: page.items.map((r) => ({
      id: r.id,
      name: r.fullName,
      mobile: maskMobile(r.mobile),
      code: r.referralCode,
      href: `${AFFILIATES}/${encodeURIComponent(r.id)}`,
      kyc: kycBadge(r.kycStatus),
      status: referrerStatusBadge(r.status),
      referees: r.refereeCount,
      earnings: formatInr(r.earningsTotal),
      enrolled: fmtDate(r.enrolledAt),
    })),
    chips: KYC_FILTERS.map((f) => ({
      key: f.key,
      label: f.label,
      active: (query.kyc ?? "all") === f.key,
      href: partnersHref(AFFILIATES, current, { kyc: f.key === "all" ? undefined : f.key, offset: 0 }),
    })),
    pagination: w,
    prevHref: w.prevOffset === null ? null : partnersHref(AFFILIATES, current, { offset: w.prevOffset }),
    nextHref: w.nextOffset === null ? null : partnersHref(AFFILIATES, current, { offset: w.nextOffset }),
    emptyReason: page.items.length > 0 ? null : filtered ? ("filtered" as const) : ("none" as const),
  };
}

export function buildReferrerDetailVM(d: ReferrerDetail, referees: Page<Referee>) {
  const status = referrerStatusBadge(d.status);
  const statusNote =
    d.status === "SUSPENDED" && d.suspensionReason ? `Suspended: ${humanize(d.suspensionReason).toLowerCase().replace(/^kyc/, "KYC")}` : null;
  return {
    id: d.id,
    name: d.fullName,
    mobile: maskMobile(d.mobile),
    code: d.referralCode,
    status,
    statusNote,
    kyc: kycBadge(d.kycStatus),
    facts: [
      { label: "Type", value: d.referrerType ? humanize(d.referrerType) : EM_DASH },
      { label: "Client code", value: d.clientCode ?? EM_DASH },
      { label: "Enrolled", value: fmtDate(d.enrolledAt) },
      { label: "Activated", value: fmtDate(d.activatedAt) },
      { label: "Referred users", value: String(d.refereeCount) },
    ],
    money: [
      { label: "Available", value: formatInr(d.wallet.available) },
      { label: "On hold", value: formatInr(d.wallet.onHold) },
      { label: "Paid out", value: formatInr(d.payouts.paidTotal) },
    ],
    earningsTotal: formatInr(d.earningsTotal),
    payoutLine: `${d.payouts.paid} paid, ${d.payouts.requested} open`,
    lastPaid: fmtDate(d.payouts.lastPaidAt),
    activity: [...d.activity]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .map((a) => ({ at: fmtDate(a.at), label: a.label ?? humanize(a.action) })),
    referees: { rows: referees.items.map(refereeRow), total: referees.total },
  };
}

/* ---------- referred users ---------- */

export function buildRefereesVM(page: Page<Referee>, query: ListQuery) {
  const path = "/partners/referred-users";
  const current: Params = { q: query.q, funnel: query.funnel };
  const w = pageWindow(page);
  return {
    rows: page.items.map(refereeRow),
    funnelChips: FUNNEL_FILTERS.map((key) => ({
      key,
      label: key === "all" ? "All" : funnelBadge(key).label,
      active: (query.funnel ?? "all") === key,
      href: partnersHref(path, current, { funnel: key === "all" ? undefined : key, offset: 0 }),
    })),
    pagination: w,
    prevHref: w.prevOffset === null ? null : partnersHref(path, current, { offset: w.prevOffset }),
    nextHref: w.nextOffset === null ? null : partnersHref(path, current, { offset: w.nextOffset }),
    emptyReason: page.items.length > 0 ? null : query.q || (query.funnel && query.funnel !== "all") ? ("filtered" as const) : ("none" as const),
  };
}

/* ---------- payouts ---------- */

const STATUS_ORDER = ["REQUESTED", "APPROVED", "PAID", "REJECTED", "CANCELLED", "FAILED"];

function payoutRow(w: Withdrawal) {
  return {
    id: w.id,
    ref: w.withdrawalRef ?? EM_DASH,
    referrer: w.referrerName ?? EM_DASH,
    referrerHref: w.referrerId ? `${AFFILIATES}/${encodeURIComponent(w.referrerId)}` : null,
    type: w.requestType ? humanize(w.requestType) : EM_DASH,
    status: withdrawalBadge(w.status),
    amount: formatInr(w.amount),
    tds: w.tdsAmount === null ? EM_DASH : formatInr(w.tdsAmount),
    net: w.netAmount === null ? EM_DASH : formatInr(w.netAmount),
    requested: fmtDate(w.requestedAt),
    decided: fmtDate(w.decidedAt),
    paid: fmtDate(w.paidAt),
  };
}

export function buildPayoutsVM(page: WithdrawalPage, query: ListQuery) {
  const path = "/partners/payouts";
  const current: Params = { status: query.status };
  const w = pageWindow(page);
  let byStatus: Record<string, { count: number; amount: number }> = page.summary?.byStatus ?? {};
  if (!page.summary) {
    byStatus = {};
    for (const i of page.items) {
      const t = (byStatus[i.status] ??= { count: 0, amount: 0 });
      t.count += 1;
      t.amount += i.amount;
    }
  }
  const keys = [...STATUS_ORDER.filter((k) => byStatus[k]), ...Object.keys(byStatus).filter((k) => !STATUS_ORDER.includes(k))];
  return {
    totals: keys.map((key) => ({ key, badge: withdrawalBadge(key), count: byStatus[key].count, amount: formatInr(byStatus[key].amount) })),
    rows: page.items.map(payoutRow),
    chips: PAYOUT_FILTERS.map((key) => ({
      key,
      label: key === "all" ? "All" : withdrawalBadge(key).label,
      active: (query.status ?? "all") === key,
      href: partnersHref(path, current, { status: key === "all" ? undefined : key, offset: 0 }),
    })),
    pagination: w,
    prevHref: w.prevOffset === null ? null : partnersHref(path, current, { offset: w.prevOffset }),
    nextHref: w.nextOffset === null ? null : partnersHref(path, current, { offset: w.nextOffset }),
    emptyReason: page.items.length > 0 ? null : query.status && query.status !== "all" ? ("filtered" as const) : ("none" as const),
  };
}
