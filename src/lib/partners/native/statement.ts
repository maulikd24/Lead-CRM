import { formatPaise, parseUnits, roundToPaise, sumUnits } from "./money";

/**
 * The maths of a partner statement for one payout. Amounts are summed exactly and rounded to paise ONCE, on the total,
 * so the total never drifts from the true figure; each line is shown rounded, and any difference between the shown
 * lines and the rounded total appears as an explicit Rounding line. Pure: no database, no clock.
 *
 * Tax is deliberately absent. The earnings engine models no TDS or GST, so none is computed or invented here; the
 * statement says so (see `assumptions`).
 */
export type StatementLineInput = { id: string; date: string; revenueType: string; clientCode: string | null; amount: string };
export type StatementAdjustmentInput = { id: string; date: string; reason: string; amount: string };
export type StatementInput = {
  lines: StatementLineInput[];
  adjustments: StatementAdjustmentInput[];
  /** The figures stored on the payout row, if there is one, to check this working against. */
  stored: { totalAccrual: string; adjustment: string; net: string } | null;
};

export const STATEMENT_ASSUMPTIONS = [
  "Amounts are commission accruals worked out by the earnings engine, in rupees.",
  "TDS and GST are not calculated here: the earnings engine does not model them. Any deduction is applied outside this system.",
  "No money is moved by this system. The net payable is an estimate until it is reconciled against the finance system.",
  "Each line is rounded to the paisa for display. The total is rounded once from the exact figures; any difference is the Rounding line.",
];

const byDateThenId = <T extends { date: string; id: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildStatement(input: StatementInput) {
  const lines = [...input.lines].sort(byDateThenId).map((l) => {
    const units = parseUnits(l.amount);
    const amountPaise = roundToPaise(units);
    return { ...l, units, amountPaise, amount: formatPaise(amountPaise) };
  });
  const adjustments = [...input.adjustments].sort(byDateThenId).map((a) => {
    const amountPaise = roundToPaise(parseUnits(a.amount));
    return { ...a, amountPaise, amount: formatPaise(amountPaise) };
  });

  const grossPaise = roundToPaise(sumUnits(lines.map((l) => l.units)));
  const shownPaise = lines.reduce((acc, l) => acc + l.amountPaise, BigInt(0));
  const roundingPaise = grossPaise - shownPaise;
  const adjustmentsPaise = adjustments.reduce((acc, a) => acc + a.amountPaise, BigInt(0));
  const netPaise = grossPaise + adjustmentsPaise;

  let stored: { matches: boolean; net: string; gross: string; adjustments: string } | null = null;
  if (input.stored) {
    const sg = roundToPaise(parseUnits(input.stored.totalAccrual));
    const sa = roundToPaise(parseUnits(input.stored.adjustment));
    const sn = roundToPaise(parseUnits(input.stored.net));
    stored = { matches: sg === grossPaise && sa === adjustmentsPaise && sn === netPaise, net: formatPaise(sn), gross: formatPaise(sg), adjustments: formatPaise(sa) };
  }

  return {
    lines: lines.map(({ units: _units, ...rest }) => rest),
    adjustments,
    grossPaise,
    roundingPaise,
    adjustmentsPaise,
    netPaise,
    gross: formatPaise(grossPaise),
    rounding: formatPaise(roundingPaise),
    adjustmentsTotal: formatPaise(adjustmentsPaise),
    net: formatPaise(netPaise),
    negativeNet: netPaise < BigInt(0),
    stored,
    assumptions: STATEMENT_ASSUMPTIONS,
  };
}

export type Statement = ReturnType<typeof buildStatement>;
