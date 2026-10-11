/**
 * Funnel estimates from OUR OWN history only. Pure. Never a benchmark, never a guess: with fewer than MIN_LEADS
 * historical leads in the audience-and-channel cell the answer is "not enough data" and no figure is produced.
 *
 * Conversion rates are shown as 90% Wilson ranges over the pooled history, so thin data gives a wide range.
 * Expected leads come from budget history (leads per rupee, lowest to highest plan) or from a number a person types.
 */
export const MIN_LEADS = 30;
const Z90 = 1.645;

export type FunnelHistoryRow = { leads: number; kyc: number; funded: number; budgetInr: number | null };
export type Range = { low: number; high: number };

export function wilson(successes: number, n: number, z = Z90): Range {
  if (n <= 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export type FunnelEstimate =
  | { status: "not_enough_data"; reason: string }
  | {
      status: "ok";
      observed: { leads: number; kyc: number; funded: number };
      rates: { kyc: Range; funded: Range };
      leads: Range | null;
      kyc: Range | null;
      funded: Range | null;
      assumptions: string[];
      notes: string[];
    };

export function estimateFunnel(input: { history: FunnelHistoryRow[]; plannedBudgetInr: number | null; expectedLeads?: number | null }): FunnelEstimate {
  const observed = input.history.reduce((a, r) => ({ leads: a.leads + r.leads, kyc: a.kyc + r.kyc, funded: a.funded + r.funded }), { leads: 0, kyc: 0, funded: 0 });
  if (observed.leads < MIN_LEADS) {
    return { status: "not_enough_data", reason: `Not enough data: ${observed.leads} past lead${observed.leads === 1 ? "" : "s"} for this audience and channel, and at least ${MIN_LEADS} are needed before a range means anything.` };
  }
  const rates = { kyc: wilson(observed.kyc, observed.leads), funded: wilson(observed.funded, observed.leads) };
  const notes: string[] = [];

  let leads: Range | null = null;
  if (input.expectedLeads != null && input.expectedLeads > 0) {
    leads = { low: Math.round(input.expectedLeads), high: Math.round(input.expectedLeads) };
  } else {
    const withBudget = input.history.filter((r) => (r.budgetInr ?? 0) > 0 && r.leads > 0);
    if (!input.plannedBudgetInr || input.plannedBudgetInr <= 0) notes.push("No budget on this plan, so expected leads are not estimated. Enter a budget or an expected number of leads.");
    else if (withBudget.length < 2) notes.push("Fewer than two past plans have a budget recorded, so expected leads from budget are not estimated.");
    else {
      const lowPlan = withBudget.reduce((a, r) => (r.leads / (r.budgetInr as number) < a.leads / (a.budgetInr as number) ? r : a));
      const highPlan = withBudget.reduce((a, r) => (r.leads / (r.budgetInr as number) > a.leads / (a.budgetInr as number) ? r : a));
      leads = { low: Math.round((input.plannedBudgetInr * lowPlan.leads) / (lowPlan.budgetInr as number)), high: Math.round((input.plannedBudgetInr * highPlan.leads) / (highPlan.budgetInr as number)) };
    }
  }

  const scale = (r: Range, l: Range): Range => ({ low: Math.round(l.low * r.low), high: Math.round(l.high * r.high) });
  const kyc = leads ? scale(rates.kyc, leads) : null;
  const funded = leads ? scale(rates.funded, leads) : null;
  return {
    status: "ok",
    observed,
    rates,
    leads,
    kyc,
    funded,
    notes,
    assumptions: [
      `Rates come from ${observed.leads} past leads of this audience on this channel (${observed.kyc} KYC approved, ${observed.funded} funded), shown as a 90% range.`,
      "Expected leads use the lowest and highest leads per rupee seen in past plans, or the number entered.",
      "Past performance of our own campaigns is not a promise for this one; this is a planning range, not a forecast.",
    ],
  };
}
