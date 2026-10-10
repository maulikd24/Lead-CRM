import type { Role } from "@/generated/prisma/client";
import type { Summary } from "../schemas";
import { buildOverviewVM, formatInr, pageWindow, type Badge } from "../view-models";
import { NATIVE_FUNNEL_FILTERS, SEGMENTS } from "./attribution";
import { explainAccrual } from "./explain";
import { longDay, periodLabel, periodShort, words } from "./format";
import { paiseToNumber, parseUnits, roundToPaise } from "./money";
import type { CommissionRow, NetworkRow, OverviewExtras, PartnerRow, PayoutRow, ReferredRow, RunRow, StatementData } from "./queries";
import { nativeHref, PARTNER_STATUSES, PARTNER_TIERS, PAYOUT_STATUSES, ACCRUAL_STATUSES, type NativeQuery } from "./query";
import type { PartnerScope } from "./scope";
import { buildStatement } from "./statement";

/** Pure builders for the native Partner pages: rows in, display-ready view models out. No fetching, no React. */

type Pg<T> = { items: T[]; total: number | null; limit: number; offset: number };
type Params = Record<string, string | number | undefined>;

/** Exact decimal string -> "₹1,234.50", rounded to paise once. */
export const inr = (exactAmount: string): string => formatInr(paiseToNumber(roundToPaise(parseUnits(exactAmount))));

/* ---------- badges ---------- */

const TIER: Record<string, string> = { PLATINUM: "Platinum", GOLD: "Gold", SILVER: "Silver", BRONZE: "Bronze" };
export const tierBadge = (tier: string): Badge => ({ label: TIER[tier] ?? words(tier), tone: "default" });

const STATUS: Record<string, Badge> = {
  ACTIVE: { label: "Active", tone: "success" },
  ONBOARDING: { label: "Onboarding", tone: "warning" },
  SUSPENDED: { label: "Suspended", tone: "destructive" },
  TERMINATED: { label: "Terminated", tone: "destructive" },
};
export const empanelmentBadge = (s: string): Badge => STATUS[s] ?? { label: words(s) || "Unknown", tone: "default" };

const PAYOUT: Record<string, Badge> = {
  ESTIMATED: { label: "Estimated", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  RECONCILED_EXTERNALLY: { label: "Reconciled outside", tone: "success" },
};
export const payoutBadge = (s: string): Badge => PAYOUT[s] ?? { label: words(s) || "Unknown", tone: "default" };

const RUN: Record<string, Badge> = {
  DRAFT: { label: "Draft", tone: "default" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  FINALIZED: { label: "Finalized", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "destructive" },
};
export const runBadge = (s: string): Badge => RUN[s] ?? { label: words(s) || "Unknown", tone: "default" };

const ACCRUAL: Record<string, Badge> = {
  ACCRUED: { label: "Accrued", tone: "default" },
  ADJUSTED: { label: "Adjusted", tone: "warning" },
  REVERSED: { label: "Reversed", tone: "destructive" },
  INCLUDED_IN_PAYOUT: { label: "In a payout", tone: "success" },
};
export const accrualBadge = (s: string): Badge => ACCRUAL[s] ?? { label: words(s) || "Unknown", tone: "default" };

const FUNNEL: Record<string, Badge> = {
  LEAD: { label: "Lead", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  DORMANT: { label: "Dormant", tone: "warning" },
  CLOSED: { label: "Closed", tone: "default" },
  SUSPENDED: { label: "Suspended", tone: "destructive" },
  ACCOUNT_OPENED: { label: "Account opened", tone: "success" },
};
export const funnelBadge = (s: string): Badge => FUNNEL[s] ?? { label: words(s) || "Unknown", tone: "default" };

/** Bank state: verified or not, and at most the last four digits. Never anything else of the account. */
export function bankText(p: { bankVerified: boolean; bankLast4: string | null }): { label: string; tail: string | null; tone: Badge["tone"] } {
  const digits = (p.bankLast4 ?? "").replace(/\D/g, "").slice(-4);
  return { label: p.bankVerified ? "Verified" : "Not verified", tail: digits ? `•••• ${digits}` : null, tone: p.bankVerified ? "success" : "warning" };
}

/** What would keep a payout from being released, in words. Information only: this system never moves money. */
export function holdReasons(p: { status: string; bankVerified: boolean }): string[] {
  const out: string[] = [];
  if (p.status !== "ACTIVE") out.push(`Partner is ${p.status.toLowerCase()}`);
  if (!p.bankVerified) out.push("Bank account not verified");
  return out;
}

/** One line saying whose data the page shows. */
export function scopeNote(scope: PartnerScope, role: Role): string {
  if (scope.kind === "all") return "Showing the whole programme.";
  if (scope.ids.length === 0) return "No partners are assigned to you yet, so there is nothing to show.";
  const n = scope.ids.length;
  const count = `${n} ${n === 1 ? "partner" : "partners"}`;
  return role === "TEAM_MANAGER" ? `Showing your team's partners (${count}).` : `Showing your network (${count}).`;
}

/* ---------- shared list helpers ---------- */

function nav(path: string, current: Params, w: ReturnType<typeof pageWindow>) {
  return {
    pagination: w,
    prevHref: w.prevOffset === null ? null : nativeHref(path, { ...current, offset: w.prevOffset }),
    nextHref: w.nextOffset === null ? null : nativeHref(path, { ...current, offset: w.nextOffset }),
    firstHref: nativeHref(path, current),
  };
}
const windowOf = <T,>(page: Pg<T>) => pageWindow({ total: page.total, limit: page.limit, offset: page.offset, count: page.items.length });
function emptyReason(count: number, w: ReturnType<typeof pageWindow>, filtered: boolean): "none" | "filtered" | "out_of_range" | null {
  if (count > 0) return null;
  if (w.outOfRange) return "out_of_range";
  return filtered ? "filtered" : "none";
}
const chip = (path: string, current: Params, key: string, label: string, param: string, active: boolean, value: string | undefined) => ({
  key,
  label,
  active,
  href: nativeHref(path, { ...current, [param]: value, offset: 0 }),
});

/* ---------- overview ---------- */

/** Largest-remainder rounding, so the shares always add up to exactly 100. */
function shares(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

export type NativeTile = { key: string; label: string; value: number | null; format: "number" | "inr"; tone: Badge["tone"]; hint?: string };

export function buildNativeOverviewVM(s: Summary, x: OverviewExtras) {
  const base = buildOverviewVM(s);
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
  const tiles: NativeTile[] = [
    { key: "earnings", label: "Earnings to date", value: s.earnings.total, format: "inr", tone: "success", hint: s.earnings.lastMonth ? `${formatInr(s.earnings.lastMonth)} in ${s.earnings.lastMonthLabel ?? "the last month"}` : undefined },
    { key: "accruals", label: "Accruals this month", value: x.accrualsThisMonth.amount, format: "inr", tone: "default", hint: `${plural(x.accrualsThisMonth.count, "accrual", "accruals")} in ${x.accrualsThisMonth.label}` },
    { key: "pending", label: "Pending payouts", value: x.pendingPayouts.amount, format: "inr", tone: "warning", hint: `${plural(x.pendingPayouts.count, "payout", "payouts")} to release` },
    { key: "referred", label: "Referred people", value: s.referees.total, format: "number", tone: "default", hint: s.referees.active === null ? undefined : `${s.referees.active.toLocaleString("en-IN")} with an active account` },
  ];
  const pct = shares(x.tierMix.map((t) => t.count));
  const segments = x.tierMix.map((t, i) => ({ tier: t.tier, label: tierBadge(t.tier).label, count: t.count, percent: pct[i] }));
  const r = s.referrers;
  return {
    tiles,
    chart: base.chart,
    top: base.top,
    tierMix: { segments, total: x.tierMix.reduce((n, t) => n + t.count, 0) },
    statusMix: [
      { key: "ACTIVE", label: "Active", count: r.active ?? 0, tone: "success" as const },
      { key: "ONBOARDING", label: "Onboarding", count: r.pending ?? 0, tone: "warning" as const },
      { key: "SUSPENDED", label: "Suspended", count: r.suspended ?? 0, tone: "destructive" as const },
      { key: "TERMINATED", label: "Terminated", count: r.terminated ?? 0, tone: "destructive" as const },
    ],
    openRuns: x.openRuns,
    isEmpty: s.referrers.total === 0,
  };
}

/* ---------- partners ---------- */

const PARTNERS = "/partners/affiliates";
const partnerHref = (id: string) => `${PARTNERS}/${encodeURIComponent(id)}`;

export function partnerRowVM(p: PartnerRow) {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    href: partnerHref(p.id),
    type: words(p.type),
    tier: tierBadge(p.tier),
    status: empanelmentBadge(p.status),
    bank: bankText(p),
    parent: p.parent ? { name: p.parent.name, href: partnerHref(p.parent.id) } : null,
    referred: p.referred,
    earned: formatInr(p.earned),
    empanelled: longDay(p.empanelledOn),
    enrolled: longDay(p.enrolled),
  };
}

export function buildPartnerListVM(page: Pg<PartnerRow>, query: NativeQuery) {
  const status = (PARTNER_STATUSES as readonly string[]).includes(query.status ?? "") ? query.status : undefined;
  const current: Params = { q: query.q, status, tier: query.tier };
  const w = windowOf(page);
  return {
    rows: page.items.map(partnerRowVM),
    statusChips: [{ key: "all", label: "All" }, ...PARTNER_STATUSES.map((k) => ({ key: k as string, label: STATUS[k].label }))].map((c) => chip(PARTNERS, current, c.key, c.label, "status", (status ?? "all") === c.key, c.key === "all" ? undefined : c.key)),
    tierChips: [{ key: "all", label: "Any tier" }, ...PARTNER_TIERS.map((k) => ({ key: k as string, label: TIER[k] }))].map((c) => chip(PARTNERS, current, c.key, c.label, "tier", (query.tier ?? "all") === c.key, c.key === "all" ? undefined : c.key)),
    ...nav(PARTNERS, current, w),
    emptyReason: emptyReason(page.items.length, w, Boolean(query.q || status || query.tier)),
  };
}

/* ---------- network ---------- */

const INDENT_STEP = 20;
const MAX_INDENT_LEVELS = 6;

export function buildNetworkVM(page: Pg<NetworkRow> & { capped: boolean }, _query: NativeQuery) {
  const w = windowOf(page);
  return {
    rows: page.items.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      href: partnerHref(r.id),
      depth: r.depth,
      indent: Math.min(r.depth, MAX_INDENT_LEVELS) * INDENT_STEP,
      hasChildren: r.childCount > 0,
      childCount: r.childCount,
      truncated: r.truncated,
      tier: tierBadge(r.tier),
      status: empanelmentBadge(r.status),
      referred: r.referred,
      own: formatInr(r.own),
      rollup: formatInr(r.rollup),
    })),
    capped: page.capped,
    ...nav("/partners/network", {}, w),
    emptyReason: emptyReason(page.items.length, w, false),
  };
}

/* ---------- referred ---------- */

const REFERRED = "/partners/referred-users";

export function buildReferredVM(page: Pg<ReferredRow>, query: NativeQuery) {
  const current: Params = { q: query.q, segment: query.segment, funnel: query.funnel, partner: query.partner };
  const w = windowOf(page);
  return {
    rows: page.items.map((r) => ({
      id: r.clientId,
      name: r.name,
      code: r.clientCode,
      kind: r.via === "ACCOUNT" ? ({ label: "Client", tone: "success" } as Badge) : ({ label: "Lead", tone: "warning" } as Badge),
      stage: funnelBadge(r.funnel),
      crmStage: r.stage,
      source: r.source ?? "—",
      since: longDay(r.since),
      partnerName: r.partner.name,
      partnerCode: r.partner.code,
      partnerHref: partnerHref(r.partner.id),
    })),
    segmentChips: SEGMENTS.map((s) => chip(REFERRED, current, s.key, s.label, "segment", query.segment === s.key, s.key)),
    funnelChips: NATIVE_FUNNEL_FILTERS.map((k) => chip(REFERRED, current, k, k === "all" ? "Any stage" : funnelBadge(k).label, "funnel", (query.funnel ?? "all") === k, k === "all" ? undefined : k)),
    partnerFilter: query.partner ? { id: query.partner, clearHref: nativeHref(REFERRED, { ...current, partner: undefined }) } : null,
    ...nav(REFERRED, current, w),
    emptyReason: emptyReason(page.items.length, w, Boolean(query.q || query.partner || query.funnel || query.segment !== "all")),
  };
}

/* ---------- commissions ---------- */

const COMMISSIONS = "/partners/commissions";

export function buildCommissionsVM(page: Pg<CommissionRow>, query: NativeQuery) {
  const current: Params = { q: query.q, accrual: query.accrual, partner: query.partner };
  const w = windowOf(page);
  return {
    rows: page.items.map((r) => ({
      id: r.id,
      date: longDay(r.date),
      partnerName: r.partner.name,
      partnerCode: r.partner.code,
      partnerHref: partnerHref(r.partner.id),
      clientCode: r.clientCode ?? "—",
      type: words(r.revenueType),
      gross: inr(r.gross),
      amount: inr(r.amount),
      status: accrualBadge(r.status),
      explanation: explainAccrual(r.explain),
    })),
    statusChips: [{ key: "all", label: "All" }, ...ACCRUAL_STATUSES.map((k) => ({ key: k as string, label: ACCRUAL[k].label }))].map((c) => chip(COMMISSIONS, current, c.key, c.label, "accrual", (query.accrual ?? "all") === c.key, c.key === "all" ? undefined : c.key)),
    viewChips: [
      { key: "accruals", label: "Accruals", active: true, href: nativeHref(COMMISSIONS, { q: query.q, partner: query.partner }) },
      { key: "adjustments", label: "Adjustments", active: false, href: nativeHref(COMMISSIONS, { view: "adjustments", partner: query.partner }) },
    ],
    ...nav(COMMISSIONS, current, w),
    emptyReason: emptyReason(page.items.length, w, Boolean(query.q || query.accrual || query.partner)),
  };
}

export function buildAdjustmentsVM(page: Pg<import("./queries").AdjustmentRow>, query: NativeQuery) {
  const current: Params = { view: "adjustments", partner: query.partner };
  const w = windowOf(page);
  return {
    rows: page.items.map((a) => ({
      id: a.id,
      date: longDay(a.date),
      partnerName: a.partner.name,
      partnerCode: a.partner.code,
      partnerHref: partnerHref(a.partner.id),
      amount: inr(a.amount),
      negative: a.amount.trim().startsWith("-"),
      reason: a.reason,
      period: a.periodStart && a.periodEnd ? periodLabel(a.periodStart, a.periodEnd) : "Not in a payout",
      approved: a.approved,
    })),
    viewChips: [
      { key: "accruals", label: "Accruals", active: false, href: nativeHref(COMMISSIONS, { partner: query.partner }) },
      { key: "adjustments", label: "Adjustments", active: true, href: nativeHref(COMMISSIONS, current) },
    ],
    ...nav(COMMISSIONS, current, w),
    emptyReason: emptyReason(page.items.length, w, Boolean(query.partner)),
  };
}

/* ---------- payouts ---------- */

const PAYOUTS = "/partners/payouts";

export function buildPayoutsVM(input: { view: "runs"; runs: Pg<RunRow> } | { view: "payouts"; payouts: Pg<PayoutRow> }, query: NativeQuery) {
  const viewChips = [
    { key: "runs", label: "Payout runs", active: input.view === "runs", href: nativeHref(PAYOUTS, {}) },
    { key: "payouts", label: "Partner payouts", active: input.view === "payouts", href: nativeHref(PAYOUTS, { view: "payouts" }) },
  ];
  if (input.view === "runs") {
    const w = windowOf(input.runs);
    return {
      viewChips,
      statusChips: null,
      payouts: null,
      runs: {
        rows: input.runs.items.map((r) => ({
          id: r.id,
          period: periodShort(r.start, r.end),
          status: runBadge(r.status),
          payouts: r.payouts,
          total: formatInr(r.total),
          approved: r.approvedAt ? longDay(r.approvedAt) : "—",
          href: nativeHref(PAYOUTS, { view: "payouts", run: r.id }),
        })),
        ...nav(PAYOUTS, {}, w),
        emptyReason: emptyReason(input.runs.items.length, w, false),
      },
    };
  }
  const payoutStatus = (PAYOUT_STATUSES as readonly string[]).includes(query.status ?? "") ? query.status : undefined;
  const current: Params = { view: "payouts", run: query.run, partner: query.partner, status: payoutStatus };
  const w = windowOf(input.payouts);
  return {
    viewChips,
    runs: null,
    statusChips: [{ key: "all", label: "All" }, ...PAYOUT_STATUSES.map((k) => ({ key: k as string, label: PAYOUT[k].label }))].map((c) => chip(PAYOUTS, current, c.key, c.label, "status", (payoutStatus ?? "all") === c.key, c.key === "all" ? undefined : c.key)),
    payouts: {
      rows: input.payouts.items.map((p) => ({
        id: p.id,
        partnerName: p.partner.name,
        partnerCode: p.partner.code,
        partnerHref: partnerHref(p.partner.id),
        period: periodShort(p.runStart, p.runEnd),
        runStatus: runBadge(p.runStatus),
        accrued: inr(p.accrued),
        adjustment: inr(p.adjustment),
        net: inr(p.net),
        status: payoutBadge(p.status),
        externalRef: p.externalRef,
        reconciled: p.reconciledAt ? longDay(p.reconciledAt) : null,
        lines: p.lines,
        empanelment: empanelmentBadge(p.empanelment),
        bank: bankText(p),
        holds: holdReasons({ status: p.empanelment, bankVerified: p.bankVerified }),
        statementHref: `/partners/statements/${encodeURIComponent(p.partner.id)}?run=${encodeURIComponent(p.runId)}`,
      })),
      clearRunHref: query.run ? nativeHref(PAYOUTS, { view: "payouts", partner: query.partner, status: payoutStatus }) : null,
      ...nav(PAYOUTS, current, w),
      emptyReason: emptyReason(input.payouts.items.length, w, Boolean(query.run || query.partner || payoutStatus)),
    },
  };
}

/* ---------- statements ---------- */

const STATEMENTS = "/partners/statements";

export function buildStatementIndexVM(page: Pg<PayoutRow>, query: NativeQuery) {
  const current: Params = { q: query.q, run: query.run };
  const w = windowOf(page);
  return {
    rows: page.items.map((p) => ({
      id: p.id,
      partnerName: p.partner.name,
      partnerCode: p.partner.code,
      period: periodShort(p.runStart, p.runEnd),
      net: inr(p.net),
      status: payoutBadge(p.status),
      runStatus: runBadge(p.runStatus),
      href: `${STATEMENTS}/${encodeURIComponent(p.partner.id)}?run=${encodeURIComponent(p.runId)}`,
      csvHref: `${STATEMENTS}/${encodeURIComponent(p.partner.id)}/export?run=${encodeURIComponent(p.runId)}`,
      printHref: `/partner-statement/${encodeURIComponent(p.partner.id)}?run=${encodeURIComponent(p.runId)}`,
    })),
    ...nav(STATEMENTS, current, w),
    emptyReason: emptyReason(page.items.length, w, Boolean(query.run)),
  };
}

export function buildOpenAccrualsVM(page: Pg<import("./queries").OpenAccrualRow>) {
  const w = windowOf(page);
  return {
    rows: page.items.map((o) => ({
      partnerName: o.partner.name,
      partnerCode: o.partner.code,
      count: o.count,
      amount: inr(o.amount),
      href: `${STATEMENTS}/${encodeURIComponent(o.partner.id)}?run=open`,
      csvHref: `${STATEMENTS}/${encodeURIComponent(o.partner.id)}/export?run=open`,
    })),
    ...nav(STATEMENTS, { view: "open" }, w),
    emptyReason: emptyReason(page.items.length, w, false),
  };
}

export function buildStatementVM(data: StatementData, show: { all: true } | { offset: number; pageSize: number }) {
  const statement = buildStatement({
    lines: data.lines,
    adjustments: data.adjustments,
    stored: data.payout ? { totalAccrual: data.payout.totalAccrual, adjustment: data.payout.adjustment, net: data.payout.net } : null,
  });
  const all = "all" in show;
  const offset = all ? 0 : show.offset;
  const size = all ? Math.max(statement.lines.length, 1) : show.pageSize;
  const rows = statement.lines.slice(offset, offset + size);
  const w = pageWindow({ total: statement.lines.length, limit: size, offset, count: rows.length });
  const money = (paise: bigint) => formatInr(paiseToNumber(paise));
  const check =
    statement.stored && !statement.stored.matches
      ? { matches: false, message: `The working here differs from the stored payout (net ${formatInr(Number(statement.stored.net))} stored, ${money(statement.netPaise)} worked out). Ask finance to review before relying on either figure.` }
      : { matches: true, message: null };
  const pid = encodeURIComponent(data.partner.id);
  const key = encodeURIComponent(data.period.key);
  return {
    partner: { id: data.partner.id, name: data.partner.name, code: data.partner.code, tier: tierBadge(data.partner.tier), type: words(data.partner.type) },
    empanelment: empanelmentBadge(data.partner.status),
    bank: bankText({ bankVerified: data.partner.bankVerifiedAt !== null, bankLast4: data.partner.bankLast4 }),
    isEstimate: data.period.kind === "open" || data.payout?.status === "ESTIMATED",
    periodLabel: data.period.kind === "open" || !data.period.start || !data.period.end ? "Accruals not yet in a payout run" : periodLabel(data.period.start, data.period.end),
    runStatus: data.run ? runBadge(data.run.status) : null,
    payoutStatus: data.payout ? payoutBadge(data.payout.status) : null,
    externalRef: data.payout?.externalRef ?? null,
    reconciled: data.payout?.reconciledAt ? longDay(data.payout.reconciledAt) : null,
    totals: { gross: money(statement.grossPaise), rounding: money(statement.roundingPaise), adjustments: money(statement.adjustmentsPaise), net: money(statement.netPaise), negativeNet: statement.negativeNet, netValue: paiseToNumber(statement.netPaise), grossValue: paiseToNumber(statement.grossPaise), adjustmentsValue: paiseToNumber(statement.adjustmentsPaise) },
    lines: {
      rows: rows.map((l) => ({ id: l.id, date: longDay(l.date), type: words(l.revenueType), clientCode: l.clientCode ?? "—", amount: formatInr(Number(l.amount)) })),
      pagination: w,
      count: statement.lines.length,
      prevOffset: w.prevOffset,
      nextOffset: w.nextOffset,
    },
    adjustments: statement.adjustments.map((a) => ({ id: a.id, date: longDay(a.date), reason: a.reason, amount: formatInr(Number(a.amount)) })),
    check,
    assumptions: statement.assumptions,
    csvHref: `/partners/statements/${pid}/export?run=${key}`,
    printHref: `/partner-statement/${pid}?run=${key}`,
    backHref: `${STATEMENTS}`,
    statement,
  };
}
