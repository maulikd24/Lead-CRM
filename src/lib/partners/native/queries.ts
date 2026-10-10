import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { Page, Summary } from "../schemas";
import { escapeLike, funnelOf, maskName, type Segment } from "./attribution";
import type { ExplainInput } from "./explain";
import { fillMonths, istMonthStart, monthKey, monthLabel, recentMonths } from "./period";
import { formatUnits, paiseToNumber, parseUnits, roundToPaise } from "./money";
import { detailAllows, detailFilter, scopeAllows, scopeFilter, type PartnerScope } from "./scope";
import { createStatementReader } from "./statement-queries";
import type { StatementAdjustmentInput, StatementLineInput } from "./statement";
import type { PartnerTaxFacts, TaxRule } from "../tax/rules";
import { flattenForest, rollupTotals } from "./tree";

/**
 * The native Partner data source: reads the Earnings Engine tables directly (PartnerProfile, CommissionRule and Slab,
 * CommissionAccrual, PayoutRun, Payout, PayoutLine, CommissionAdjustment) and the existing attribution fields. No
 * network, no external key. Every query is narrowed by a PartnerScope that the caller resolved from the signed-in
 * user's role, so a partner user can only ever reach their own sub-tree.
 *
 * What it never reads: PAN, GSTIN, full bank details, mobile, e-mail. A partner row carries a name, the partner code
 * and the last four digits of the bank account. A referred person carries a masked name and a customer code.
 *
 * It serves the summary the Overview and the rail share, plus the native reads the workspace needs (tree, commissions,
 * payouts, statements).
 */
export type NativeDb = Pick<PrismaClient, "partnerProfile" | "commissionAccrual" | "commissionAdjustment" | "payout" | "payoutRun" | "payoutLine" | "partnerCommissionAssignment" | "partnerTaxRule" | "partnerOverrideRule" | "$queryRaw">;

export { MAX_STATEMENT_LINES } from "./statement-queries";
export const NATIVE_PAGE_SIZE = 25;
const MAX_PAGE = 100;
const MAX_NETWORK_PARTNERS = 5000;

const clampLimit = (n: number | undefined) => Math.min(Math.max(Math.trunc(n ?? NATIVE_PAGE_SIZE) || NATIVE_PAGE_SIZE, 1), MAX_PAGE);
const clampOffset = (n: number | undefined) => Math.max(Math.trunc(n ?? 0) || 0, 0);

type Dec = { toFixed(): string } | null | undefined;
const exact = (d: Dec): string => (d == null ? "0" : d.toFixed());
/** Rupees as a number, rounded to paise once, for display. Exact sums use `exact`. */
const rupees = (d: Dec | string | null | undefined): number => (d == null ? 0 : paiseToNumber(roundToPaise(parseUnits(typeof d === "string" ? d : d.toFixed()))));
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const last4 = (v: string | null | undefined): string | null => {
  const digits = (v ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
};
const COUNTED = { not: "REVERSED" } as const;

/* ------------------------------------------------------------------ row types */

export type PartnerRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  tier: string;
  status: string;
  empanelledOn: string | null;
  bankVerified: boolean;
  bankLast4: string | null;
  /** The parent in the commercial roll-up, only when the viewer may see that partner. */
  parent: { id: string; code: string; name: string } | null;
  referred: number;
  earned: number;
  enrolled: string;
};

export type NetworkRow = { id: string; code: string; name: string; tier: string; status: string; depth: number; childCount: number; truncated: boolean; own: number; override: number; rollup: number; referred: number };

export type ReferredRow = {
  clientId: string;
  clientCode: string;
  name: string;
  via: "ACCOUNT" | "LEAD";
  funnel: string;
  stage: string;
  source: string | null;
  since: string;
  partner: { id: string; code: string; name: string };
};

export type CommissionRow = {
  id: string;
  date: string;
  status: string;
  partner: { id: string; code: string; name: string };
  clientCode: string | null;
  revenueType: string;
  gross: string;
  amount: string;
  /** Set for an override accrual: the rule it was paid under. Never carries the sub-partner's customer. */
  override: { level: number; ratePercent: string; capPerAccrual: string | null } | null;
  explain: ExplainInput;
};

export type AdjustmentRow = { id: string; date: string; partner: { id: string; code: string; name: string }; amount: string; reason: string; periodStart: string | null; periodEnd: string | null; approved: boolean };

export type RunRow = { id: string; start: string; end: string; status: string; approvedAt: string | null; finalizedAt: string | null; payouts: number; total: number };

export type PayoutRow = {
  id: string;
  runId: string;
  runStart: string;
  runEnd: string;
  runStatus: string;
  partner: { id: string; code: string; name: string };
  accrued: string;
  adjustment: string;
  net: string;
  status: string;
  externalRef: string | null;
  reconciledAt: string | null;
  lines: number;
  /** The partner's empanelment status and bank state, shown beside the payout. Only the last four digits of the account. */
  empanelment: string;
  bankVerified: boolean;
  bankLast4: string | null;
};

export type OpenAccrualRow = { partner: { id: string; code: string; name: string }; count: number; amount: string };

export type StatementData = {
  partner: { id: string; code: string; name: string; type: string; tier: string; status: string; bankLast4: string | null; bankVerifiedAt: string | null };
  period: { kind: "run" | "open" | "month" | "fy" | "fyc"; start: string | null; end: string | null; key: string };
  run: { id: string; status: string } | null;
  payout: { id: string; status: string; externalRef: string | null; reconciledAt: string | null; totalAccrual: string; adjustment: string; net: string } | null;
  lines: StatementLineInput[];
  adjustments: StatementAdjustmentInput[];
  /** "totals": the viewer may see this partner's totals but not their lines (no customer codes, no tax detail). */
  detail: "full" | "totals";
  /** Exact totals, present when detail is "totals". */
  aggregate: { accruals: string; adjustments: string } | null;
  /** What the tax maths needs. Null when no tax is shown (open estimate, or totals only). */
  tax: { rules: TaxRule[]; facts: PartnerTaxFacts; at: string; priorBase: string } | null;
  /** The financial year to date, month by month. Present only for that statement. */
  cumulative: { priorBase: string; months: { key: string; accruals: string; adjustments: string }[] } | null;
};

export type PeriodStatementRow = { partner: { id: string; code: string; name: string }; count: number; total: string; detail: boolean };

export type PartnerDetail = {
  row: PartnerRow;
  plan: { name: string; code: string; since: string } | null;
  subPartners: { id: string; code: string; name: string; tier: string; status: string }[];
  subPartnerCount: number;
  totals: { lifetime: number; open: number; pendingPayout: number; paidOut: number };
  recentPayouts: PayoutRow[];
};

export type OverviewExtras = {
  accrualsThisMonth: { count: number; amount: number; label: string };
  pendingPayouts: { count: number; amount: number };
  openRuns: number | null;
  /** Draft payout runs that include the viewer's partners: counted, never listed. Always 0 for admin and finance, who see drafts. */
  hiddenRuns: number;
  tierMix: { tier: string; count: number }[];
};

export interface NativePartnerPort {
  getSummary(): Promise<Summary>;
  getOverviewExtras(): Promise<OverviewExtras>;
  listPartners(f: { q?: string; status?: string; tier?: string; offset?: number; limit?: number }): Promise<Page<PartnerRow>>;
  getPartnerDetail(id: string): Promise<PartnerDetail | null>;
  getNetwork(f: { offset?: number; limit?: number }): Promise<Page<NetworkRow> & { capped: boolean }>;
  /** `hidden` counts referred people in the viewer's scope whose lines they may not see (their sub-partners' people). */
  listReferred(f: { q?: string; segment?: Segment; funnel?: string; partnerId?: string; offset?: number; limit?: number }): Promise<Page<ReferredRow> & { hidden: number }>;
  /** `others` is the exact count and total of accruals in the viewer's scope that they may not see line by line. */
  listCommissions(f: { partnerId?: string; status?: string; q?: string; offset?: number; limit?: number }): Promise<Page<CommissionRow> & { total: number; others: { count: number; amount: string } | null }>;
  listAdjustments(f: { partnerId?: string; offset?: number; limit?: number }): Promise<Page<AdjustmentRow>>;
  listPayoutRuns(f: { offset?: number; limit?: number }): Promise<Page<RunRow>>;
  listPayouts(f: { runId?: string; partnerId?: string; status?: string; q?: string; offset?: number; limit?: number }): Promise<Page<PayoutRow>>;
  listOpenAccruals(f: { offset?: number; limit?: number }): Promise<Page<OpenAccrualRow>>;
  getStatement(partnerId: string, period: string): Promise<StatementData | null>;
  listPeriodStatements(f: { kind: "month" | "fy"; key: string; offset?: number; limit?: number }): Promise<Page<PeriodStatementRow>>;
}

/* ------------------------------------------------------------------ attribution SQL */

const scopeSql = (scope: PartnerScope, column: string): Prisma.Sql => (scope.kind === "all" ? Prisma.sql`TRUE` : Prisma.sql`${Prisma.raw(column)} = ANY(${scope.ids}::text[])`);

/**
 * Who is referred by whom, one row per person (see attribution.ts for the two sources). Free text is compared
 * case-insensitively against partner codes; nothing user-typed is ever concatenated into the SQL.
 */
function attributedCte(scope: PartnerScope, now: Date): Prisma.Sql {
  return Prisma.sql`attributed AS (
    SELECT ta."clientId" AS client_id, ta."sourcingPartnerId" AS partner_id, 'ACCOUNT'::text AS via
    FROM (
      SELECT DISTINCT ON (t."clientId") t."clientId", t."sourcingPartnerId"
      FROM "TradingAccount" t
      WHERE t."sourcingPartnerId" IS NOT NULL AND ${scopeSql(scope, 't."sourcingPartnerId"')}
      ORDER BY t."clientId", t."createdAt", t.id
    ) ta
    UNION ALL
    SELECT touch."clientId", touch."partnerProfileId", 'LEAD'::text
    FROM "PartnerReferralTouch" touch
    WHERE touch."expiresAt" > ${now} AND ${scopeSql(scope, 'touch."partnerProfileId"')}
      AND NOT EXISTS (SELECT 1 FROM "TradingAccount" t2 WHERE t2."clientId" = touch."clientId" AND t2."sourcingPartnerId" IS NOT NULL)
    UNION ALL
    SELECT c.id, p.id, 'LEAD'::text
    FROM "Client" c
    JOIN "PartnerProfile" p ON upper(p."partnerCode") = upper(NULLIF(c."referralSource", ''))
    WHERE ${scopeSql(scope, "p.id")}
      AND NOT EXISTS (SELECT 1 FROM "TradingAccount" t2 WHERE t2."clientId" = c.id AND t2."sourcingPartnerId" IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM "PartnerReferralTouch" t3 WHERE t3."clientId" = c.id AND t3."expiresAt" > ${now})
  )`;
}

const REFERRED_JOINS = Prisma.sql`
  FROM attributed a
  JOIN "Client" c ON c.id = a.client_id AND c."isDeleted" = false AND c."mergedIntoId" IS NULL
  JOIN "Stage" s ON s.id = c."currentStageId"
  JOIN "PartnerProfile" p ON p.id = a.partner_id
  JOIN "User" u ON u.id = p."userId"
  LEFT JOIN LATERAL (
    SELECT bool_or(t.status = 'ACTIVE') AS any_active, count(*)::int AS n, (array_agg(t.status::text ORDER BY t."createdAt" DESC))[1] AS latest
    FROM "TradingAccount" t WHERE t."clientId" = c.id AND t."sourcingPartnerId" = a.partner_id
  ) ta ON true`;

type RawReferred = {
  clientId: string;
  clientCode: string;
  clientName: string;
  leadSource: string | null;
  createdAt: Date;
  stage: string;
  via: "ACCOUNT" | "LEAD";
  partnerId: string;
  partnerCode: string;
  partnerName: string;
  anyActive: boolean | null;
  accounts: number | null;
  latestStatus: string | null;
  total: number;
};

/* ------------------------------------------------------------------ the port */

export function createNativePort(db: NativeDb, scope: PartnerScope, opts: { now?: () => Date } = {}): NativePartnerPort {
  const now = () => (opts.now ? opts.now() : new Date());
  const statements = createStatementReader(db, scope, now);
  const pid = scopeFilter(scope);
  const narrow = (partnerId?: string): PartnerScope => {
    if (!partnerId) return scope;
    return scopeAllows(scope, partnerId) ? { kind: "ids", ids: [partnerId], detailIds: detailAllows(scope, partnerId) ? [partnerId] : [] } : { kind: "ids", ids: [], detailIds: [] };
  };

  async function referredCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<{ partnerId: string; n: number }[]>(Prisma.sql`
      WITH ${attributedCte({ kind: "ids", ids, detailIds: [] }, now())}
      SELECT a.partner_id AS "partnerId", count(*)::int AS n ${REFERRED_JOINS} GROUP BY a.partner_id`);
    return new Map(rows.map((r) => [r.partnerId, r.n]));
  }

  /** The part of a scope whose customer-level lines the viewer may see. */
  const detailScopeOf = (sc: PartnerScope): PartnerScope => (sc.kind === "all" ? sc : { kind: "ids", ids: sc.detailIds.filter((id) => sc.ids.includes(id)), detailIds: [] });

  async function countReferred(sc: PartnerScope): Promise<number> {
    if (sc.kind !== "all" && sc.ids.length === 0) return 0;
    const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`WITH ${attributedCte(sc, now())} SELECT count(*)::int AS n ${REFERRED_JOINS}`);
    return rows[0]?.n ?? 0;
  }

  async function earnedBy(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await db.commissionAccrual.groupBy({ by: ["partnerProfileId"], where: { partnerProfileId: { in: ids }, status: COUNTED }, _sum: { accrualAmount: true } });
    return new Map(rows.map((r) => [r.partnerProfileId, exact(r._sum.accrualAmount)]));
  }

  /** Commission earned and override earned per partner (reversed accruals excluded), exact. */
  async function earnedSplit(ids: string[]): Promise<Map<string, { own: string; override: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<{ partnerId: string; own: string; override: string }[]>(Prisma.sql`
      SELECT "partnerProfileId" AS "partnerId",
             COALESCE(SUM("accrualAmount") FILTER (WHERE "overrideRuleId" IS NULL), 0)::text AS own,
             COALESCE(SUM("accrualAmount") FILTER (WHERE "overrideRuleId" IS NOT NULL), 0)::text AS override
      FROM "CommissionAccrual" WHERE status <> 'REVERSED' AND "partnerProfileId" = ANY(${ids}::text[]) GROUP BY 1`);
    return new Map(rows.map((r) => [r.partnerId, { own: r.own, override: r.override }]));
  }

  const profileSelect = {
    id: true,
    partnerCode: true,
    partnerType: true,
    tier: true,
    empanelmentStatus: true,
    empanelmentDate: true,
    bankVerifiedAt: true,
    bankAccountLast4: true,
    parentPartnerProfileId: true,
    createdAt: true,
    user: { select: { name: true } },
  } as const;
  type Profile = Prisma.PartnerProfileGetPayload<{ select: typeof profileSelect }>;

  async function toRows(profiles: Profile[]): Promise<PartnerRow[]> {
    const ids = profiles.map((p) => p.id);
    const parentIds = [...new Set(profiles.map((p) => p.parentPartnerProfileId).filter((x): x is string => !!x && scopeAllows(scope, x)))];
    const [counts, earned, parents] = await Promise.all([
      referredCounts(ids),
      earnedBy(ids),
      parentIds.length ? db.partnerProfile.findMany({ where: { id: { in: parentIds } }, select: { id: true, partnerCode: true, user: { select: { name: true } } } }) : Promise.resolve([]),
    ]);
    const parentById = new Map(parents.map((p) => [p.id, { id: p.id, code: p.partnerCode, name: p.user.name }]));
    return profiles.map((p) => ({
      id: p.id,
      code: p.partnerCode,
      name: p.user.name,
      type: p.partnerType,
      tier: p.tier,
      status: p.empanelmentStatus,
      empanelledOn: iso(p.empanelmentDate),
      bankVerified: p.bankVerifiedAt !== null,
      bankLast4: last4(p.bankAccountLast4),
      parent: p.parentPartnerProfileId ? (parentById.get(p.parentPartnerProfileId) ?? null) : null,
      referred: counts.get(p.id) ?? 0,
      earned: rupees(earned.get(p.id)),
      enrolled: p.createdAt.toISOString(),
    }));
  }

  const partnerWhere = (f: { q?: string; status?: string; tier?: string }): Prisma.PartnerProfileWhereInput => {
    const q = f.q?.trim();
    return {
      id: pid,
      ...(f.status ? { empanelmentStatus: f.status as never } : {}),
      ...(f.tier ? { tier: f.tier as never } : {}),
      ...(q ? { OR: [{ partnerCode: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    };
  };

  const who = (p: { id: string; partnerCode: string; user: { name: string } }) => ({ id: p.id, code: p.partnerCode, name: p.user.name });

  async function payoutRows(where: Prisma.PayoutWhereInput, f: { offset?: number; limit?: number }): Promise<Page<PayoutRow>> {
    const limit = clampLimit(f.limit);
    const offset = clampOffset(f.offset);
    const [total, rows] = await Promise.all([
      db.payout.count({ where }),
      db.payout.findMany({
        where,
        orderBy: [{ payoutRun: { periodStart: "desc" } }, { id: "asc" }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          payoutRunId: true,
          totalAccrualAmount: true,
          adjustmentAmount: true,
          netPayableAmount: true,
          status: true,
          externalPayoutRef: true,
          reconciledAt: true,
          payoutRun: { select: { periodStart: true, periodEnd: true, status: true } },
          partnerProfile: { select: { id: true, partnerCode: true, empanelmentStatus: true, bankVerifiedAt: true, bankAccountLast4: true, user: { select: { name: true } } } },
          _count: { select: { lines: true } },
        },
      }),
    ]);
    return {
      total,
      limit,
      offset,
      items: rows.map((r) => ({
        id: r.id,
        runId: r.payoutRunId,
        runStart: r.payoutRun.periodStart.toISOString(),
        runEnd: r.payoutRun.periodEnd.toISOString(),
        runStatus: r.payoutRun.status,
        partner: who(r.partnerProfile),
        accrued: exact(r.totalAccrualAmount),
        adjustment: exact(r.adjustmentAmount),
        net: exact(r.netPayableAmount),
        status: r.status,
        externalRef: r.externalPayoutRef,
        reconciledAt: iso(r.reconciledAt),
        lines: r._count.lines,
        empanelment: r.partnerProfile.empanelmentStatus,
        bankVerified: r.partnerProfile.bankVerifiedAt !== null,
        bankLast4: last4(r.partnerProfile.bankAccountLast4),
      })),
    };
  }

  /** Partner and team-manager views never include a run that is still being worked on. */
  const visibleRunStatus: Prisma.PayoutWhereInput = scope.kind === "all" ? {} : { payoutRun: { status: { notIn: ["DRAFT"] } } };

  const port: NativePartnerPort = {
    /* ---- summary ---- */

    async getSummary(): Promise<Summary> {
      const at = now();
      const thisMonth = istMonthStart(at);
      const lastMonth = istMonthStart(at, -1);
      const months = recentMonths(at, 8);
      const from = istMonthStart(at, -7);

      const [byStatus, referred, lastMonthSum, totalSum, monthlyRows, top] = await Promise.all([
        db.partnerProfile.groupBy({ by: ["empanelmentStatus"], where: { id: pid }, _count: { _all: true } }),
        db.$queryRaw<{ total: number; active: number }[]>(Prisma.sql`
          WITH ${attributedCte(scope, now())}
          SELECT count(*)::int AS total, (count(*) FILTER (WHERE ta.any_active))::int AS active ${REFERRED_JOINS}`),
        db.commissionAccrual.aggregate({ where: { partnerProfileId: pid, status: COUNTED, accrualDate: { gte: lastMonth, lt: thisMonth } }, _sum: { accrualAmount: true } }),
        db.commissionAccrual.aggregate({ where: { partnerProfileId: pid, status: COUNTED }, _sum: { accrualAmount: true } }),
        db.$queryRaw<{ period: string; amount: string }[]>(Prisma.sql`
          SELECT to_char((("accrualDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS period, SUM("accrualAmount")::text AS amount
          FROM "CommissionAccrual"
          WHERE status <> 'REVERSED' AND "accrualDate" >= ${from} AND ${scopeSql(scope, '"partnerProfileId"')}
          GROUP BY 1 ORDER BY 1`),
        db.commissionAccrual.groupBy({ by: ["partnerProfileId"], where: { partnerProfileId: pid, status: COUNTED }, _sum: { accrualAmount: true }, orderBy: { _sum: { accrualAmount: "desc" } }, take: 5 }),
      ]);
      const count = (s: string) => byStatus.find((b) => b.empanelmentStatus === s)?._count._all ?? 0;
      const total = byStatus.reduce((n, b) => n + b._count._all, 0);

      const topProfiles = top.length ? await db.partnerProfile.findMany({ where: { id: { in: top.map((t) => t.partnerProfileId) } }, select: profileSelect }) : [];
      const topCounts = await referredCounts(top.map((t) => t.partnerProfileId));
      const byId = new Map(topProfiles.map((p) => [p.id, p]));

      return {
        referrers: { total, active: count("ACTIVE"), pending: count("ONBOARDING"), suspended: count("SUSPENDED"), terminated: count("TERMINATED") },
        referees: { total: referred[0]?.total ?? 0, active: referred[0]?.active ?? 0 },
        earnings: { lastMonth: rupees(lastMonthSum._sum.accrualAmount), lastMonthLabel: monthLabel(monthKey(new Date(lastMonth.getTime() + 60_000))), total: rupees(totalSum._sum.accrualAmount) },
        monthly: fillMonths(months, monthlyRows).map((m) => ({ ...m, referees: null })),
        topReferrers: top.flatMap((t) => {
          const p = byId.get(t.partnerProfileId);
          return p ? [{ id: p.id, fullName: p.user.name, referralCode: p.partnerCode, refereeCount: topCounts.get(p.id) ?? 0, earningsTotal: rupees(t._sum.accrualAmount) }] : [];
        }),
      };
    },

    /* ---- reads ---- */

    async getOverviewExtras(): Promise<OverviewExtras> {
      const at = now();
      const monthStart = istMonthStart(at);
      const [accr, pending, openRuns, tiers, hiddenRuns] = await Promise.all([
        db.commissionAccrual.aggregate({ where: { partnerProfileId: pid, status: COUNTED, accrualDate: { gte: monthStart } }, _sum: { accrualAmount: true }, _count: { _all: true } }),
        db.payout.aggregate({ where: { partnerProfileId: pid, status: { in: ["ESTIMATED", "APPROVED"] }, payoutRun: { status: { notIn: scope.kind === "all" ? ["CANCELLED"] : ["CANCELLED", "DRAFT"] } } }, _sum: { netPayableAmount: true }, _count: { _all: true } }),
        scope.kind === "all" ? db.payoutRun.count({ where: { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] } } }) : Promise.resolve(null),
        db.partnerProfile.groupBy({ by: ["tier"], where: { id: pid }, _count: { _all: true } }),
        scope.kind === "all" ? Promise.resolve(0) : db.payoutRun.count({ where: { status: "DRAFT", payouts: { some: { partnerProfileId: pid } } } }),
      ]);
      const order = ["PLATINUM", "GOLD", "SILVER", "BRONZE"];
      return {
        accrualsThisMonth: { count: accr._count._all, amount: rupees(accr._sum.accrualAmount), label: monthLabel(monthKey(new Date(monthStart.getTime() + 60_000))) },
        pendingPayouts: { count: pending._count._all, amount: rupees(pending._sum.netPayableAmount) },
        openRuns,
        hiddenRuns,
        tierMix: tiers.map((t) => ({ tier: t.tier, count: t._count._all })).sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier)),
      };
    },

    async listPartners(f): Promise<Page<PartnerRow>> {
      const limit = clampLimit(f.limit);
      const offset = clampOffset(f.offset);
      const where = partnerWhere(f);
      const [total, profiles] = await Promise.all([
        db.partnerProfile.count({ where }),
        db.partnerProfile.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: offset, take: limit, select: profileSelect }),
      ]);
      return { total, limit, offset, items: await toRows(profiles) };
    },

    async getPartnerDetail(id): Promise<PartnerDetail | null> {
      // Not allowed and not existing look the same, so the page cannot be used to probe for partners.
      if (!scopeAllows(scope, id)) return null;
      const profile = await db.partnerProfile.findUnique({ where: { id }, select: profileSelect });
      if (!profile) return null;
      const at = now();
      const [rows, subs, subCount, plan, life, open, pending, paid, recent] = await Promise.all([
        toRows([profile]),
        db.partnerProfile.findMany({ where: { parentPartnerProfileId: id, ...(pid ? { id: pid } : {}) }, orderBy: { partnerCode: "asc" }, take: 50, select: { id: true, partnerCode: true, tier: true, empanelmentStatus: true, user: { select: { name: true } } } }),
        db.partnerProfile.count({ where: { parentPartnerProfileId: id, ...(pid ? { id: pid } : {}) } }),
        db.partnerCommissionAssignment.findFirst({ where: { partnerProfileId: id, validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gt: at } }] }, orderBy: { validFrom: "desc" }, select: { validFrom: true, commissionPlan: { select: { name: true, code: true } } } }),
        db.commissionAccrual.aggregate({ where: { partnerProfileId: id, status: COUNTED }, _sum: { accrualAmount: true } }),
        db.commissionAccrual.aggregate({ where: { partnerProfileId: id, status: "ACCRUED", payoutLines: { none: {} } }, _sum: { accrualAmount: true } }),
        db.payout.aggregate({ where: { partnerProfileId: id, status: { in: ["ESTIMATED", "APPROVED"] }, ...visibleRunStatus }, _sum: { netPayableAmount: true } }),
        db.payout.aggregate({ where: { partnerProfileId: id, status: "RECONCILED_EXTERNALLY" }, _sum: { netPayableAmount: true } }),
        payoutRows({ partnerProfileId: id, ...visibleRunStatus }, { limit: 5 }),
      ]);
      return {
        row: rows[0],
        plan: plan ? { name: plan.commissionPlan.name, code: plan.commissionPlan.code, since: plan.validFrom.toISOString() } : null,
        subPartners: subs.map((s) => ({ id: s.id, code: s.partnerCode, name: s.user.name, tier: s.tier, status: s.empanelmentStatus })),
        subPartnerCount: subCount,
        totals: { lifetime: rupees(life._sum.accrualAmount), open: rupees(open._sum.accrualAmount), pendingPayout: rupees(pending._sum.netPayableAmount), paidOut: rupees(paid._sum.netPayableAmount) },
        recentPayouts: recent.items,
      };
    },

    async getNetwork(f) {
      const limit = clampLimit(f.limit);
      const offset = clampOffset(f.offset);
      const partners = await db.partnerProfile.findMany({
        where: { id: pid },
        orderBy: { partnerCode: "asc" },
        take: MAX_NETWORK_PARTNERS + 1,
        select: { id: true, partnerCode: true, tier: true, empanelmentStatus: true, parentPartnerProfileId: true, user: { select: { name: true } } },
      });
      const capped = partners.length > MAX_NETWORK_PARTNERS;
      const list = partners.slice(0, MAX_NETWORK_PARTNERS);
      const ids = list.map((p) => p.id);
      const [split, counts] = await Promise.all([earnedSplit(ids), referredCounts(ids.slice(0, 2000))]);
      // Own commission and the branch total leave override accruals out: an override is a share of a sub-partner's commission, so counting it in
      // the branch would count the same money twice. It is shown in its own column.
      const own = new Map<string, bigint>(ids.map((id) => [id, roundToPaise(parseUnits(split.get(id)?.own ?? "0"))]));
      const nodes = list.map((p) => ({ id: p.id, parentId: p.parentPartnerProfileId, code: p.partnerCode, name: p.user.name, tier: p.tier, status: p.empanelmentStatus }));
      const rolled = rollupTotals(nodes, own);
      const flat = flattenForest(nodes);
      const rows: NetworkRow[] = flat.slice(offset, offset + limit).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        tier: r.tier,
        status: r.status,
        depth: r.depth,
        childCount: r.childCount,
        truncated: r.truncated,
        own: paiseToNumber(own.get(r.id) ?? BigInt(0)),
        override: paiseToNumber(roundToPaise(parseUnits(split.get(r.id)?.override ?? "0"))),
        rollup: paiseToNumber(rolled.get(r.id) ?? BigInt(0)),
        referred: counts.get(r.id) ?? 0,
      }));
      return { items: rows, total: flat.length, limit, offset, capped };
    },

    async listReferred(f): Promise<Page<ReferredRow> & { hidden: number }> {
      const limit = clampLimit(f.limit);
      const offset = clampOffset(f.offset);
      // Rows (customer codes) only for partners whose lines the viewer may see; everyone else in scope is a count.
      const inScope = narrow(f.partnerId);
      const narrowed = detailScopeOf(inScope);
      const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
      if (f.segment === "clients") conds.push(Prisma.sql`a.via = 'ACCOUNT'`);
      if (f.segment === "leads") conds.push(Prisma.sql`a.via = 'LEAD'`);
      if (f.funnel === "LEAD") conds.push(Prisma.sql`a.via = 'LEAD'`);
      else if (f.funnel === "ACTIVE") conds.push(Prisma.sql`COALESCE(ta.any_active, false)`);
      else if (f.funnel === "DORMANT" || f.funnel === "CLOSED" || f.funnel === "SUSPENDED") conds.push(Prisma.sql`a.via = 'ACCOUNT' AND NOT COALESCE(ta.any_active, false) AND ta.latest = ${f.funnel}`);
      const q = f.q?.trim().slice(0, 80);
      if (q) {
        const like = `%${escapeLike(q)}%`;
        conds.push(Prisma.sql`(c."clientCode" ILIKE ${like} ESCAPE '\\' OR p."partnerCode" ILIKE ${like} ESCAPE '\\' OR u.name ILIKE ${like} ESCAPE '\\')`);
      }
      const rows = await db.$queryRaw<RawReferred[]>(Prisma.sql`
        WITH ${attributedCte(narrowed, now())}
        SELECT c.id AS "clientId", c."clientCode", c.name AS "clientName", c."leadSource", c."createdAt", s.name AS stage, a.via,
               a.partner_id AS "partnerId", p."partnerCode", u.name AS "partnerName",
               ta.any_active AS "anyActive", ta.n AS accounts, ta.latest AS "latestStatus",
               (count(*) OVER())::int AS total
        ${REFERRED_JOINS}
        WHERE ${Prisma.join(conds, " AND ")}
        ORDER BY c."createdAt" DESC, c.id
        LIMIT ${limit} OFFSET ${offset}`);
      let total = rows[0]?.total ?? 0;
      if (rows.length === 0 && offset > 0) {
        // Past the end: the window count is empty, so ask once for the real total (the page can then say so).
        const c = await db.$queryRaw<{ n: number }[]>(Prisma.sql`WITH ${attributedCte(narrowed, now())} SELECT count(*)::int AS n ${REFERRED_JOINS} WHERE ${Prisma.join(conds, " AND ")}`);
        total = c[0]?.n ?? 0;
      }
      const hidden = inScope.kind === "all" ? 0 : Math.max(0, (await countReferred(inScope)) - (await countReferred(narrowed)));
      return {
        total,
        limit,
        offset,
        hidden,
        items: rows.map((r) => ({
          clientId: r.clientId,
          clientCode: r.clientCode,
          name: maskName(r.clientName),
          via: r.via,
          funnel: funnelOf({ via: r.via, anyActive: r.anyActive === true, accounts: r.accounts ?? 0, latestStatus: r.latestStatus }),
          stage: r.stage,
          source: r.leadSource,
          since: r.createdAt.toISOString(),
          partner: { id: r.partnerId, code: r.partnerCode, name: r.partnerName },
        })),
      };
    },

    async listCommissions(f) {
      const limit = clampLimit(f.limit);
      const offset = clampOffset(f.offset);
      const q = f.q?.trim().slice(0, 80);
      // Accrual lines only for partners whose lines the viewer may see; the rest of the scope is one exact aggregate.
      const lineIds = f.partnerId ? (detailAllows(scope, f.partnerId) ? { in: [f.partnerId] } : { in: [] as string[] }) : detailFilter(scope);
      const otherIds = scope.kind === "all" ? [] : f.partnerId ? (scopeAllows(scope, f.partnerId) && !detailAllows(scope, f.partnerId) ? [f.partnerId] : []) : scope.ids.filter((id) => !scope.detailIds.includes(id));
      const where: Prisma.CommissionAccrualWhereInput = {
        partnerProfileId: lineIds,
        ...(f.status ? { status: f.status as never } : {}),
        ...(q ? { OR: [{ revenueEvent: { client: { clientCode: { contains: q, mode: "insensitive" } } } }, { partnerProfile: { partnerCode: { contains: q, mode: "insensitive" } } }] } : {}),
      };
      const [total, rows, othersAgg] = await Promise.all([
        db.commissionAccrual.count({ where }),
        db.commissionAccrual.findMany({
          where,
          orderBy: [{ accrualDate: "desc" }, { id: "asc" }],
          skip: offset,
          take: limit,
          select: {
            id: true,
            accrualAmount: true,
            accrualDate: true,
            status: true,
            computationVersion: true,
            overrideRuleId: true,
            sourceAccrualId: true,
            partnerProfile: { select: { id: true, partnerCode: true, user: { select: { name: true } } } },
            revenueEvent: { select: { grossRevenueAmount: true, revenueType: true, eventDate: true, client: { select: { clientCode: true } } } },
            commissionRule: {
              select: {
                rateType: true,
                percentRate: true,
                flatRate: true,
                productCategory: true,
                transactionType: true,
                validFrom: true,
                validTo: true,
                slabs: { orderBy: { minAmount: "asc" }, select: { minAmount: true, maxAmount: true, rate: true } },
                commissionPlan: { select: { name: true } },
              },
            },
          },
        }),
        otherIds.length ? db.commissionAccrual.aggregate({ where: { partnerProfileId: { in: otherIds }, status: f.status ? (f.status as never) : COUNTED }, _count: { _all: true }, _sum: { accrualAmount: true } }) : Promise.resolve(null),
      ]);
      const overrideIds = [...new Set(rows.map((r) => r.overrideRuleId).filter((x): x is string => !!x))];
      const overrideRules = overrideIds.length ? await db.partnerOverrideRule.findMany({ where: { id: { in: overrideIds } }, select: { id: true, level: true, ratePercent: true, capPerAccrual: true } }) : [];
      const ruleById = new Map(overrideRules.map((r) => [r.id, r]));
      // Only admin and finance may see the sub-partner's own figure behind an override.
      const sourceIds = scope.kind === "all" ? [...new Set(rows.map((r) => r.sourceAccrualId).filter((x): x is string => !!x))] : [];
      const sources = sourceIds.length ? await db.commissionAccrual.findMany({ where: { id: { in: sourceIds } }, select: { id: true, accrualAmount: true } }) : [];
      const sourceAmount = new Map(sources.map((x) => [x.id, exact(x.accrualAmount)]));
      return {
        total,
        limit,
        offset,
        others: othersAgg && othersAgg._count._all > 0 ? { count: othersAgg._count._all, amount: exact(othersAgg._sum.accrualAmount) } : null,
        items: rows.map((r) => {
          const ov = r.overrideRuleId ? (ruleById.get(r.overrideRuleId) ?? null) : null;
          const override = ov ? { level: ov.level, ratePercent: formatUnits(parseUnits(ov.ratePercent.toFixed())), capPerAccrual: ov.capPerAccrual === null ? null : formatUnits(parseUnits(ov.capPerAccrual.toFixed())) } : null;
          return {
            id: r.id,
            date: r.accrualDate.toISOString(),
            status: r.status,
            partner: who(r.partnerProfile),
            // An override accrual shares the sub-partner's revenue event: it never shows that customer or that revenue.
            clientCode: r.overrideRuleId ? null : (r.revenueEvent.client?.clientCode ?? null),
            revenueType: r.overrideRuleId ? "OVERRIDE" : r.revenueEvent.revenueType,
            gross: r.overrideRuleId ? "0" : exact(r.revenueEvent.grossRevenueAmount),
            amount: exact(r.accrualAmount),
            override,
            explain: {
              storedAmount: exact(r.accrualAmount),
              grossRevenue: r.overrideRuleId ? "0" : exact(r.revenueEvent.grossRevenueAmount),
              revenueType: r.overrideRuleId ? "OVERRIDE" : r.revenueEvent.revenueType,
              eventDate: r.revenueEvent.eventDate.toISOString(),
              computationVersion: r.computationVersion,
              planName: r.commissionRule?.commissionPlan.name ?? null,
              ...(override ? { override: { ...override, sourceAmount: r.sourceAccrualId ? (sourceAmount.get(r.sourceAccrualId) ?? null) : null } } : {}),
              rule: r.commissionRule
                ? {
                    rateType: r.commissionRule.rateType,
                    percentRate: r.commissionRule.percentRate === null ? null : exact(r.commissionRule.percentRate),
                    flatRate: r.commissionRule.flatRate === null ? null : exact(r.commissionRule.flatRate),
                    productCategory: r.commissionRule.productCategory,
                    transactionType: r.commissionRule.transactionType,
                    validFrom: r.commissionRule.validFrom.toISOString(),
                    validTo: iso(r.commissionRule.validTo),
                    slabs: r.commissionRule.slabs.map((s) => ({ minAmount: exact(s.minAmount), maxAmount: s.maxAmount === null ? null : exact(s.maxAmount), rate: exact(s.rate) })),
                  }
                : null,
            },
          };
        }),
      };
    },

    async listAdjustments(f): Promise<Page<AdjustmentRow>> {
      const limit = clampLimit(f.limit);
      const offset = clampOffset(f.offset);
      const where: Prisma.CommissionAdjustmentWhereInput = { partnerProfileId: scopeFilter(narrow(f.partnerId)), ...(scope.kind === "all" ? {} : { OR: [{ payoutId: null }, { payout: { payoutRun: { status: { notIn: ["DRAFT"] } } } }] }) };
      const [total, rows] = await Promise.all([
        db.commissionAdjustment.count({ where }),
        db.commissionAdjustment.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: offset,
          take: limit,
          select: { id: true, amount: true, reason: true, createdAt: true, approvalRequestId: true, partnerProfile: { select: { id: true, partnerCode: true, user: { select: { name: true } } } }, payout: { select: { payoutRun: { select: { periodStart: true, periodEnd: true } } } } },
        }),
      ]);
      return {
        total,
        limit,
        offset,
        items: rows.map((r) => ({
          id: r.id,
          date: r.createdAt.toISOString(),
          partner: who(r.partnerProfile),
          amount: exact(r.amount),
          reason: r.reason.slice(0, 300),
          periodStart: iso(r.payout?.payoutRun.periodStart),
          periodEnd: iso(r.payout?.payoutRun.periodEnd),
          approved: r.approvalRequestId !== null,
        })),
      };
    },

    async listPayoutRuns(f): Promise<Page<RunRow>> {
      const limit = clampLimit(f.limit);
      const offset = clampOffset(f.offset);
      const where: Prisma.PayoutRunWhereInput = scope.kind === "all" ? {} : { status: { notIn: ["DRAFT"] }, payouts: { some: { partnerProfileId: pid } } };
      const [total, runs] = await Promise.all([
        db.payoutRun.count({ where }),
        db.payoutRun.findMany({ where, orderBy: [{ periodStart: "desc" }, { id: "asc" }], skip: offset, take: limit, select: { id: true, periodStart: true, periodEnd: true, status: true, approvedAt: true, finalizedAt: true } }),
      ]);
      const sums = runs.length ? await db.payout.groupBy({ by: ["payoutRunId"], where: { payoutRunId: { in: runs.map((r) => r.id) }, partnerProfileId: pid }, _count: { _all: true }, _sum: { netPayableAmount: true } }) : [];
      const byRun = new Map(sums.map((s) => [s.payoutRunId, s]));
      return {
        total,
        limit,
        offset,
        items: runs.map((r) => ({
          id: r.id,
          start: r.periodStart.toISOString(),
          end: r.periodEnd.toISOString(),
          status: r.status,
          approvedAt: iso(r.approvedAt),
          finalizedAt: iso(r.finalizedAt),
          payouts: byRun.get(r.id)?._count._all ?? 0,
          total: rupees(byRun.get(r.id)?._sum.netPayableAmount),
        })),
      };
    },

    async listPayouts(f): Promise<Page<PayoutRow>> {
      const q = f.q?.trim().slice(0, 80);
      const where: Prisma.PayoutWhereInput = {
        partnerProfileId: scopeFilter(narrow(f.partnerId)),
        ...(f.runId ? { payoutRunId: f.runId } : {}),
        ...(f.status ? { status: f.status as never } : {}),
        ...(q ? { partnerProfile: { OR: [{ partnerCode: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }] } } : {}),
        ...visibleRunStatus,
      };
      return payoutRows(where, f);
    },

    async listOpenAccruals(f): Promise<Page<OpenAccrualRow>> {
      const limit = clampLimit(f.limit);
      const offset = clampOffset(f.offset);
      const groups = await db.commissionAccrual.groupBy({ by: ["partnerProfileId"], where: { partnerProfileId: pid, status: "ACCRUED", payoutLines: { none: {} } }, _count: { _all: true }, _sum: { accrualAmount: true }, orderBy: { partnerProfileId: "asc" } });
      const page = groups.slice(offset, offset + limit);
      const profiles = page.length ? await db.partnerProfile.findMany({ where: { id: { in: page.map((g) => g.partnerProfileId) } }, select: { id: true, partnerCode: true, user: { select: { name: true } } } }) : [];
      const byId = new Map(profiles.map((p) => [p.id, p]));
      return {
        total: groups.length,
        limit,
        offset,
        items: page.flatMap((g) => {
          const p = byId.get(g.partnerProfileId);
          return p ? [{ partner: who(p), count: g._count._all, amount: exact(g._sum.accrualAmount) }] : [];
        }),
      };
    },

    getStatement: (partnerId, period) => statements.getStatement(partnerId, period),

    async listPeriodStatements(f): Promise<Page<PeriodStatementRow>> {
      const limit = clampLimit(f.limit);
      const offset = clampOffset(f.offset);
      const r = await statements.listPeriodStatements({ kind: f.kind, key: f.key, offset, limit });
      return { items: r.items, total: r.total, limit, offset };
    },
  };
  return port;
}
