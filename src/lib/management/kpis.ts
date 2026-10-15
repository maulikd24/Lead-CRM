/**
 * Management intelligence: the headline KPIs for Admin and Manager. Pure and deterministic. The caller (the existing reporting
 * loaders) hands in counts and day totals that are already computed; nothing here reads the database or names a customer.
 *
 * Output is aggregates only: every field is a number or null. There is no row, id, name or list in the result, so a customer
 * cannot leak through it by construction. A ratio or average with no base (zero denominator, no data) is null, never Infinity or NaN.
 */

export type KpiInput = {
  /** Leads created in the period. */
  leadsCreated: number;
  /** Of the leads created in the period, how many converted to an active client. */
  leadsConverted: number;
  /** Sum of days taken across every completed stage-to-stage move in the period. */
  stageDaysTotal: number;
  /** Number of completed stage-to-stage moves that contributed to stageDaysTotal. */
  stageMoves: number;
  /** Complaints still open now. */
  complaintsOpen: number;
  /** Open complaints past their due date now. Must not exceed complaintsOpen. */
  complaintsOverdue: number;
  /** Commitments (promises to a customer) past their due date and not kept. */
  promisesOverdue: number;
};

export type HeadlineKpis = {
  leadsCreated: number;
  leadsConverted: number;
  /** leadsConverted / leadsCreated, as a 0 to 1 fraction. Null when no leads were created. */
  conversionRate: number | null;
  /** Mean days per stage-to-stage move. Null when there were no moves. */
  avgDaysStageToStage: number | null;
  complaintsOpen: number;
  complaintsOverdue: number;
  promisesOverdue: number;
};

export type KpiProblem = "negative_or_non_finite" | "converted_exceeds_created" | "overdue_exceeds_open";

export type HeadlineResult = { ok: true; kpis: HeadlineKpis } | { ok: false; problems: KpiProblem[] };

const isCount = (n: number) => Number.isFinite(n) && n >= 0;

/** A fraction or average with no valid base is null. Never Infinity, never NaN. */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function headlineKpis(input: KpiInput): HeadlineResult {
  const problems = new Set<KpiProblem>();
  const numbers = [input.leadsCreated, input.leadsConverted, input.stageDaysTotal, input.stageMoves, input.complaintsOpen, input.complaintsOverdue, input.promisesOverdue];
  if (!numbers.every(isCount)) problems.add("negative_or_non_finite");
  if (input.leadsConverted > input.leadsCreated) problems.add("converted_exceeds_created");
  if (input.complaintsOverdue > input.complaintsOpen) problems.add("overdue_exceeds_open");
  if (problems.size > 0) return { ok: false, problems: [...problems] };

  return {
    ok: true,
    kpis: {
      leadsCreated: input.leadsCreated,
      leadsConverted: input.leadsConverted,
      conversionRate: safeRatio(input.leadsConverted, input.leadsCreated),
      avgDaysStageToStage: safeRatio(input.stageDaysTotal, input.stageMoves),
      complaintsOpen: input.complaintsOpen,
      complaintsOverdue: input.complaintsOverdue,
      promisesOverdue: input.promisesOverdue,
    },
  };
}
