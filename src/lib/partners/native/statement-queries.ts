import { Prisma } from "@/generated/prisma/client";
import type { PartnerTaxFacts, TaxRule } from "../tax/rules";
import { loadTaxRules } from "../tax/store";
import { formatUnits, parseUnits } from "./money";
import { fyKeyOf, fyMonths, fyRange, monthKey, monthRange, parseStatementPeriod } from "./period";
import type { NativeDb, PeriodStatementRow, StatementData } from "./queries";
import { detailAllows, scopeAllows, scopeFilter, type PartnerScope } from "./scope";
import type { StatementAdjustmentInput, StatementLineInput } from "./statement";

/**
 * Reads the data a partner statement is built from, for a payout run, an open estimate, a calendar month, a financial year
 * or the financial year to date. A viewer who may not see a partner's lines gets exact totals only: no line, no customer
 * code, no tax detail ever leaves this module for them.
 */
export const MAX_STATEMENT_LINES = 20000;

type Dec = { toFixed(): string } | null | undefined;
/** An exact decimal without trailing zeros ("154.99995", "0"). */
const exact = (d: Dec): string => (d == null ? "0" : formatUnits(parseUnits(d.toFixed())));
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const last4 = (v: string | null | undefined): string | null => {
  const digits = (v ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-4) : null;
};
const addExact = (a: string, b: string): string => formatUnits(parseUnits(a) + parseUnits(b));
const COUNTED = { not: "REVERSED" } as const;
const FROZEN_RUNS = ["PENDING_APPROVAL", "APPROVED", "FINALIZED"] as const;

export function createStatementReader(db: NativeDb, scope: PartnerScope, now: () => Date) {
  /** Adjustments a non-admin viewer may count: those not attached to a draft run. */
  const adjustmentVisible: Prisma.CommissionAdjustmentWhereInput = scope.kind === "all" ? {} : { OR: [{ payoutId: null }, { payout: { payoutRun: { status: { notIn: ["DRAFT"] } } } }] };

  async function taxFacts(partnerId: string, partnerType: string): Promise<PartnerTaxFacts> {
    // Presence only: the PAN and GSTIN themselves are never selected.
    const rows = await db.$queryRaw<{ hasPan: boolean; hasGstin: boolean }[]>(Prisma.sql`
      SELECT ("panNumber" IS NOT NULL AND "panNumber" <> '') AS "hasPan", ("gstin" IS NOT NULL AND "gstin" <> '') AS "hasGstin" FROM "PartnerProfile" WHERE id = ${partnerId}`);
    return { partnerType, hasPan: rows[0]?.hasPan === true, hasGstin: rows[0]?.hasGstin === true };
  }

  const capNow = (end: Date): string => new Date(Math.min(end.getTime() - 1, now().getTime())).toISOString();

  async function accrualAndAdjustmentSums(partnerId: string, start: Date, end: Date): Promise<{ accruals: string; adjustments: string }> {
    const [a, adj] = await Promise.all([
      db.commissionAccrual.aggregate({ where: { partnerProfileId: partnerId, status: COUNTED, accrualDate: { gte: start, lt: end } }, _sum: { accrualAmount: true } }),
      db.commissionAdjustment.aggregate({ where: { partnerProfileId: partnerId, createdAt: { gte: start, lt: end }, ...adjustmentVisible }, _sum: { amount: true } }),
    ]);
    return { accruals: exact(a._sum.accrualAmount), adjustments: exact(adj._sum.amount) };
  }

  async function overrideLevels(ruleIds: (string | null)[]): Promise<Map<string, number>> {
    const ids = [...new Set(ruleIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return new Map();
    const rows = await db.partnerOverrideRule.findMany({ where: { id: { in: ids } }, select: { id: true, level: true } });
    return new Map(rows.map((r) => [r.id, r.level]));
  }

  const lineOf = (id: string, date: Date, amount: Dec, ev: { revenueType: string; client: { clientCode: string } | null }, overrideRuleId: string | null, levels: Map<string, number>): StatementLineInput => {
    const level = overrideRuleId ? (levels.get(overrideRuleId) ?? null) : null;
    // An override line is a share of a sub-partner's commission: it never carries that sub-partner's customer.
    return { id, date: date.toISOString(), revenueType: overrideRuleId ? "OVERRIDE" : ev.revenueType, clientCode: overrideRuleId ? null : (ev.client?.clientCode ?? null), amount: exact(amount), ...(overrideRuleId ? { label: `Override, level ${level ?? "?"}` } : {}) };
  };
  const lineSelect = { accrualAmount: true, accrualDate: true, id: true, overrideRuleId: true, revenueEvent: { select: { revenueType: true, client: { select: { clientCode: true } } } } } as const;

  async function adjustmentsIn(partnerId: string, start: Date, end: Date): Promise<StatementAdjustmentInput[]> {
    const rows = await db.commissionAdjustment.findMany({ where: { partnerProfileId: partnerId, createdAt: { gte: start, lt: end }, ...adjustmentVisible }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, reason: true, createdAt: true } });
    return rows.map((a) => ({ id: a.id, date: a.createdAt.toISOString(), reason: a.reason.slice(0, 300), amount: exact(a.amount) }));
  }

  async function getStatement(partnerId: string, periodKey: string): Promise<StatementData | null> {
    if (!scopeAllows(scope, partnerId)) return null;
    const parsed = parseStatementPeriod(periodKey);
    if (!parsed) return null;
    const profile = await db.partnerProfile.findUnique({ where: { id: partnerId }, select: { id: true, partnerCode: true, partnerType: true, tier: true, empanelmentStatus: true, bankAccountLast4: true, bankVerifiedAt: true, user: { select: { name: true } } } });
    if (!profile) return null;
    const partner = { id: profile.id, code: profile.partnerCode, name: profile.user.name, type: profile.partnerType, tier: profile.tier, status: profile.empanelmentStatus, bankLast4: last4(profile.bankAccountLast4), bankVerifiedAt: iso(profile.bankVerifiedAt) };
    const detail: StatementData["detail"] = detailAllows(scope, partnerId) ? "full" : "totals";
    const base = { partner, detail, lines: [] as StatementLineInput[], adjustments: [] as StatementAdjustmentInput[], aggregate: null as StatementData["aggregate"], tax: null as StatementData["tax"], cumulative: null as StatementData["cumulative"], run: null as StatementData["run"], payout: null as StatementData["payout"] };
    const taxContext = async (at: string, priorBase: string): Promise<StatementData["tax"]> => (detail === "full" ? { rules: await loadTaxRules(db) as TaxRule[], facts: await taxFacts(partnerId, profile.partnerType), at, priorBase } : null);

    if (parsed.kind === "open") {
      if (detail === "totals") {
        const a = await db.commissionAccrual.aggregate({ where: { partnerProfileId: partnerId, status: "ACCRUED", payoutLines: { none: {} } }, _sum: { accrualAmount: true } });
        return { ...base, period: { kind: "open", start: null, end: null, key: "open" }, aggregate: { accruals: exact(a._sum.accrualAmount), adjustments: "0" } };
      }
      const accruals = await db.commissionAccrual.findMany({ where: { partnerProfileId: partnerId, status: "ACCRUED", payoutLines: { none: {} } }, orderBy: [{ accrualDate: "asc" }, { id: "asc" }], take: MAX_STATEMENT_LINES + 1, select: lineSelect });
      if (accruals.length > MAX_STATEMENT_LINES) throw new Error("too_many_lines");
      const levels = await overrideLevels(accruals.map((a) => a.overrideRuleId));
      return { ...base, period: { kind: "open", start: null, end: null, key: "open" }, lines: accruals.map((a) => lineOf(a.id, a.accrualDate, a.accrualAmount, a.revenueEvent, a.overrideRuleId, levels)) };
    }

    if (parsed.kind === "run") {
      const payout = await db.payout.findUnique({
        where: { payoutRunId_partnerProfileId: { payoutRunId: parsed.runId, partnerProfileId: partnerId } },
        select: { id: true, status: true, externalPayoutRef: true, reconciledAt: true, totalAccrualAmount: true, adjustmentAmount: true, netPayableAmount: true, payoutRun: { select: { id: true, status: true, periodStart: true, periodEnd: true } } },
      });
      if (!payout) return null;
      if (scope.kind !== "all" && payout.payoutRun.status === "DRAFT") return null;
      const run = payout.payoutRun;
      const fyStart = fyRange(fyKeyOf(run.periodStart))!.start;
      const prior = await db.payout.aggregate({ where: { partnerProfileId: partnerId, payoutRun: { periodStart: { gte: fyStart, lt: run.periodStart }, status: { in: [...FROZEN_RUNS] } } }, _sum: { netPayableAmount: true } });
      const common = {
        ...base,
        period: { kind: "run" as const, start: run.periodStart.toISOString(), end: run.periodEnd.toISOString(), key: run.id },
        run: { id: run.id, status: run.status },
        payout: { id: payout.id, status: payout.status, externalRef: payout.externalPayoutRef, reconciledAt: iso(payout.reconciledAt), totalAccrual: exact(payout.totalAccrualAmount), adjustment: exact(payout.adjustmentAmount), net: exact(payout.netPayableAmount) },
      };
      if (detail === "totals") return { ...common, aggregate: { accruals: exact(payout.totalAccrualAmount), adjustments: exact(payout.adjustmentAmount) } };
      const [lines, adjustments] = await Promise.all([
        db.payoutLine.findMany({ where: { payoutId: payout.id }, orderBy: [{ id: "asc" }], take: MAX_STATEMENT_LINES + 1, select: { id: true, amount: true, commissionAccrual: { select: { accrualDate: true, overrideRuleId: true, revenueEvent: { select: { revenueType: true, client: { select: { clientCode: true } } } } } } } }),
        db.commissionAdjustment.findMany({ where: { payoutId: payout.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, reason: true, createdAt: true } }),
      ]);
      if (lines.length > MAX_STATEMENT_LINES) throw new Error("too_many_lines");
      const levels = await overrideLevels(lines.map((l) => l.commissionAccrual.overrideRuleId));
      return {
        ...common,
        lines: lines.map((l) => lineOf(l.id, l.commissionAccrual.accrualDate, l.amount, l.commissionAccrual.revenueEvent, l.commissionAccrual.overrideRuleId, levels)),
        adjustments: adjustments.map((a) => ({ id: a.id, date: a.createdAt.toISOString(), reason: a.reason.slice(0, 300), amount: exact(a.amount) })),
        tax: await taxContext(capNow(run.periodEnd), exact(prior._sum.netPayableAmount)),
      };
    }

    if (parsed.kind === "month" || parsed.kind === "fy") {
      const range = parsed.kind === "month" ? monthRange(parsed.month)! : fyRange(parsed.fy)!;
      const fyStart = parsed.kind === "month" ? fyRange(fyKeyOf(range.start))!.start : range.start;
      const period = { kind: parsed.kind, start: range.start.toISOString(), end: range.end.toISOString(), key: periodKey };
      if (detail === "totals") return { ...base, period, aggregate: await accrualAndAdjustmentSums(partnerId, range.start, range.end) };
      const [accruals, adjustments] = await Promise.all([
        db.commissionAccrual.findMany({ where: { partnerProfileId: partnerId, status: COUNTED, accrualDate: { gte: range.start, lt: range.end } }, orderBy: [{ accrualDate: "asc" }, { id: "asc" }], take: MAX_STATEMENT_LINES + 1, select: lineSelect }),
        adjustmentsIn(partnerId, range.start, range.end),
      ]);
      if (accruals.length > MAX_STATEMENT_LINES) throw new Error("too_many_lines");
      const levels = await overrideLevels(accruals.map((a) => a.overrideRuleId));
      let priorBase = "0";
      if (parsed.kind === "month" && range.start.getTime() > fyStart.getTime()) {
        const sums = await accrualAndAdjustmentSums(partnerId, fyStart, range.start);
        priorBase = addExact(sums.accruals, sums.adjustments);
      }
      return { ...base, period, lines: accruals.map((a) => lineOf(a.id, a.accrualDate, a.accrualAmount, a.revenueEvent, a.overrideRuleId, levels)), adjustments, tax: await taxContext(capNow(range.end), priorBase) };
    }

    // The financial year to date, month by month.
    const range = fyRange(parsed.fy)!;
    const period = { kind: "fyc" as const, start: range.start.toISOString(), end: range.end.toISOString(), key: periodKey };
    const upTo = monthKey(new Date(Math.min(now().getTime(), range.end.getTime() - 1)));
    const keys = fyMonths(parsed.fy).filter((k) => k <= upTo);
    if (detail === "totals") return { ...base, period, aggregate: await accrualAndAdjustmentSums(partnerId, range.start, range.end) };
    const [accrualRows, adjustmentRows] = await Promise.all([
      db.$queryRaw<{ m: string; total: string }[]>(Prisma.sql`
        SELECT to_char(("accrualDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS m, SUM("accrualAmount")::text AS total
        FROM "CommissionAccrual" WHERE "partnerProfileId" = ${partnerId} AND status <> 'REVERSED' AND "accrualDate" >= ${range.start} AND "accrualDate" < ${range.end} GROUP BY 1`),
      db.$queryRaw<{ m: string; total: string }[]>(Prisma.sql`
        SELECT to_char((a."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS m, SUM(a.amount)::text AS total
        FROM "CommissionAdjustment" a LEFT JOIN "Payout" p ON p.id = a."payoutId" LEFT JOIN "PayoutRun" r ON r.id = p."payoutRunId"
        WHERE a."partnerProfileId" = ${partnerId} AND a."createdAt" >= ${range.start} AND a."createdAt" < ${range.end}
          AND (${scope.kind === "all"} OR a."payoutId" IS NULL OR r.status <> 'DRAFT') GROUP BY 1`),
    ]);
    const byA = new Map(accrualRows.map((r) => [r.m, r.total]));
    const byAdj = new Map(adjustmentRows.map((r) => [r.m, r.total]));
    return {
      ...base,
      period,
      cumulative: { priorBase: "0", months: keys.map((k) => ({ key: k, accruals: formatUnits(parseUnits(byA.get(k) ?? "0")), adjustments: formatUnits(parseUnits(byAdj.get(k) ?? "0")) })) },
      tax: await taxContext(capNow(range.end), "0"),
    };
  }

  /** Partners with accruals in a calendar month or a financial year, with their totals, narrowed to the viewer's scope. Paged. */
  async function listPeriodStatements(f: { kind: "month" | "fy"; key: string; offset: number; limit: number }): Promise<{ items: PeriodStatementRow[]; total: number }> {
    const range = f.kind === "month" ? monthRange(f.key) : fyRange(f.key);
    if (!range) return { items: [], total: 0 };
    const filter = scopeFilter(scope);
    const scopeCond = filter === undefined ? Prisma.sql`TRUE` : Prisma.sql`a."partnerProfileId" = ANY(${filter.in}::text[])`;
    const rows = await db.$queryRaw<{ id: string; code: string; name: string; n: number; total: string; rows: number }[]>(Prisma.sql`
      WITH g AS (
        SELECT a."partnerProfileId" AS pid, count(*)::int AS n, SUM(a."accrualAmount")::text AS total
        FROM "CommissionAccrual" a
        WHERE a.status <> 'REVERSED' AND a."accrualDate" >= ${range.start} AND a."accrualDate" < ${range.end} AND ${scopeCond}
        GROUP BY 1)
      SELECT p.id, p."partnerCode" AS code, u.name, g.n, g.total, (count(*) OVER())::int AS rows
      FROM g JOIN "PartnerProfile" p ON p.id = g.pid JOIN "User" u ON u.id = p."userId"
      ORDER BY p."partnerCode", p.id LIMIT ${f.limit} OFFSET ${f.offset}`);
    let total = rows[0]?.rows ?? 0;
    if (rows.length === 0 && f.offset > 0) {
      const c = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(DISTINCT a."partnerProfileId")::int AS n FROM "CommissionAccrual" a WHERE a.status <> 'REVERSED' AND a."accrualDate" >= ${range.start} AND a."accrualDate" < ${range.end} AND ${scopeCond}`);
      total = c[0]?.n ?? 0;
    }
    return { total, items: rows.map((r) => ({ partner: { id: r.id, code: r.code, name: r.name }, count: r.n, total: formatUnits(parseUnits(r.total)), detail: detailAllows(scope, r.id) })) };
  }

  return { getStatement, listPeriodStatements };
}
