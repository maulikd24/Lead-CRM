import { formatDate } from "@/lib/utils/format";
import { maskMobile } from "./mask";
import type { Page, Referee, Referrer, ReferrerDetail, Summary, Withdrawal, WithdrawalPage } from "./schemas";

/** Pure builders: API data in, display-ready view models out. No fetching, no React. */

export type Tone = "default" | "success" | "warning" | "destructive";
export type Badge = { label: string; tone: Tone };

const EM_DASH = "—";

export function humanize(raw: string): string {
  // Mixed-case single words ("Needs info") are already written for people; SHOUTING_CASE and separators are not.
  if (!/[_\-\s]/.test(raw) && raw !== raw.toUpperCase()) return raw;
  const t = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : EM_DASH;
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

/**
 * One generic classifier for every status family: the tone comes from what the word means, not from a list of
 * known values, so a new status never breaks a page. Anything with no recognisable meaning is shown as "Unknown".
 */
function statusBadge(raw: string | null | undefined): Badge {
  if (!raw) return { label: "Unknown", tone: "default" };
  const n = norm(raw);
  const label = humanize(raw);
  if (/reject|fail|block|suspend|terminat/.test(n)) return { label, tone: "destructive" };
  if (/dormant/.test(n)) return { label, tone: "warning" };
  if (/inactive|cancel/.test(n)) return { label, tone: "default" };
  if (/pending|request|progress|needs?info|review|awaiting|under/.test(n)) return { label, tone: "warning" };
  if (/paid|active|accept|verified|opened|approved|complete|success/.test(n)) return { label, tone: "success" };
  return { label: "Unknown", tone: "default" };
}
export const kycBadge = statusBadge;
export const referrerStatusBadge = statusBadge;
export const funnelBadge = statusBadge;
export const withdrawalBadge = statusBadge;

/* ---------- pagination and links ---------- */

export function pageWindow({ total, limit, offset, count }: { total: number | null; limit: number; offset: number; count: number }) {
  const size = Math.max(1, limit);
  const totalKnown = total !== null;
  const outOfRange = totalKnown && total > 0 && count === 0 && offset >= total;
  const from = count === 0 ? 0 : offset + 1;
  const to = count === 0 ? 0 : offset + count;
  return {
    page: Math.floor(offset / size) + 1,
    pages: totalKnown ? Math.max(1, Math.ceil(total / size)) : null,
    from,
    to,
    total,
    totalKnown,
    prevOffset: offset > 0 ? Math.max(0, offset - size) : null,
    // Unknown total: assume more exist while a full page keeps coming back.
    nextOffset: totalKnown ? (offset + size < total ? offset + size : null) : count >= size ? offset + size : null,
    outOfRange,
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

export type Kpi = { key: string; label: string; value: number | null; format: "number" | "inr"; tone: Tone; hint?: string };

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
  const approved = s.referrers.active;
  const kpis: Kpi[] = [
    { key: "affiliates", label: "Affiliates", value: s.referrers.total, format: "number", tone: "default" },
    // The service's meaning of "pending" is not confirmed: the label says what it is believed to cover.
    { key: "pending", label: "Pending (eligibility + agreement)", value: s.referrers.pending, format: "number", tone: "warning" },
    { key: "approved", label: "Approved", value: approved, format: "number", tone: "success", hint: approved === null ? undefined : `of ${s.referrers.total}` },
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

/* ---------- shared list helpers ---------- */

const AFFILIATES = "/partners/affiliates";

function navLinks(path: string, current: Params, w: ReturnType<typeof pageWindow>) {
  return {
    pagination: w,
    prevHref: w.prevOffset === null ? null : partnersHref(path, current, { offset: w.prevOffset }),
    nextHref: w.nextOffset === null ? null : partnersHref(path, current, { offset: w.nextOffset }),
    firstHref: partnersHref(path, current, { offset: 0 }),
  };
}

type EmptyReason = "none" | "filtered" | "out_of_range" | null;
function emptyReason(count: number, w: ReturnType<typeof pageWindow>, filtered: boolean): EmptyReason {
  if (count > 0) return null;
  if (w.outOfRange) return "out_of_range";
  return filtered ? "filtered" : "none";
}

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

/* ---------- affiliates ---------- */

export function buildAffiliateListVM(page: Page<Referrer>, query: ListQuery) {
  const current: Params = { q: query.q, kyc: query.kyc };
  const w = pageWindow({ total: page.total, limit: page.limit, offset: page.offset, count: page.items.length });
  const filtered = Boolean(query.q || (query.kyc && query.kyc !== "all"));
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
    ...navLinks(AFFILIATES, current, w),
    emptyReason: emptyReason(page.items.length, w, filtered),
  };
}

const dash = (n: number | null) => (n === null ? EM_DASH : formatInr(n));

export function buildReferrerDetailVM(d: ReferrerDetail, referees: Page<Referee>) {
  const status = referrerStatusBadge(d.status);
  const time = (v: string) => {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? -Infinity : t;
  };
  return {
    id: d.id,
    name: d.fullName,
    mobile: maskMobile(d.mobile),
    code: d.referralCode,
    status,
    statusNote: d.suspensionReason ? `Reason: ${humanize(d.suspensionReason)}` : null,
    kyc: kycBadge(d.kycStatus),
    facts: [
      { label: "Type", value: d.referrerType ? humanize(d.referrerType) : EM_DASH },
      { label: "Client code", value: d.clientCode ?? EM_DASH },
      { label: "Enrolled", value: fmtDate(d.enrolledAt) },
      { label: "Activated", value: fmtDate(d.activatedAt) },
      { label: "Referred users", value: String(d.refereeCount) },
    ],
    money: [
      { label: "Available", value: dash(d.wallet?.available ?? null) },
      { label: "On hold", value: dash(d.wallet?.onHold ?? null) },
      { label: "Paid out", value: dash(d.payouts?.paidTotal ?? null) },
    ],
    earningsTotal: formatInr(d.earningsTotal),
    payoutLine: d.payouts && d.payouts.paid !== null && d.payouts.requested !== null ? `${d.payouts.paid} paid, ${d.payouts.requested} open` : "Payouts not reported",
    lastPaid: fmtDate(d.payouts?.lastPaidAt),
    activity: [...d.activity]
      .sort((a, b) => time(b.at) - time(a.at))
      .map((a) => ({ at: fmtDate(a.at), label: a.label ?? humanize(a.action) })),
    referees: { rows: referees.items.map(refereeRow), total: referees.total },
  };
}

/* ---------- referred users ---------- */

export function buildRefereesVM(page: Page<Referee>, query: ListQuery) {
  const path = "/partners/referred-users";
  const current: Params = { q: query.q, funnel: query.funnel };
  const w = pageWindow({ total: page.total, limit: page.limit, offset: page.offset, count: page.items.length });
  return {
    rows: page.items.map(refereeRow),
    funnelChips: FUNNEL_FILTERS.map((key) => ({
      key,
      label: key === "all" ? "All" : humanize(key),
      active: (query.funnel ?? "all") === key,
      href: partnersHref(path, current, { funnel: key === "all" ? undefined : key, offset: 0 }),
    })),
    ...navLinks(path, current, w),
    emptyReason: emptyReason(page.items.length, w, Boolean(query.q || (query.funnel && query.funnel !== "all"))),
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
    tds: dash(w.tdsAmount),
    net: dash(w.netAmount),
    requested: fmtDate(w.requestedAt),
    decided: fmtDate(w.decidedAt),
    paid: fmtDate(w.paidAt),
  };
}

export function buildPayoutsVM(page: WithdrawalPage, query: ListQuery) {
  const path = "/partners/payouts";
  const current: Params = { status: query.status };
  const w = pageWindow({ total: page.total, limit: page.limit, offset: page.offset, count: page.items.length });
  // Totals are shown only when the service supplies programme-wide figures. A sum over the visible page is never presented as a total.
  const byStatus = page.summary?.byStatus ?? {};
  const keys = page.summary ? [...STATUS_ORDER.filter((k) => byStatus[k]), ...Object.keys(byStatus).filter((k) => !STATUS_ORDER.includes(k))] : [];
  return {
    totalsSource: page.summary ? ("server" as const) : ("none" as const),
    totals: keys.map((key) => ({ key, badge: withdrawalBadge(key), count: byStatus[key].count, amount: formatInr(byStatus[key].amount) })),
    rows: page.items.map(payoutRow),
    chips: PAYOUT_FILTERS.map((key) => ({
      key,
      label: key === "all" ? "All" : humanize(key),
      active: (query.status ?? "all") === key,
      href: partnersHref(path, current, { status: key === "all" ? undefined : key, offset: 0 }),
    })),
    ...navLinks(path, current, w),
    emptyReason: emptyReason(page.items.length, w, Boolean(query.status && query.status !== "all")),
  };
}
