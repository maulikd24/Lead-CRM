import { applyTax, ROUNDING_RULE, TAX_NOTE, type TaxResult } from "../tax/compute";
import type { PartnerTaxFacts, TaxRule } from "../tax/rules";
import { formatPaise, parseUnits, roundToPaise, sumUnits } from "./money";
import { monthRange } from "./period";

/**
 * The maths of a partner statement for one payout. Amounts are summed exactly and rounded to paise ONCE, on the total,
 * so the total never drifts from the true figure; each line is shown rounded, and any difference between the shown
 * lines and the rounded total appears as an explicit Rounding line. Pure: no database, no clock.
 *
 * Tax comes only from the rules Finance configured (see ../tax). With none configured there is no tax line, nothing is
 * deducted and the statement says so; no rate is ever assumed.
 */
export type StatementLineInput = { id: string; date: string; revenueType: string; clientCode: string | null; amount: string };
export type StatementAdjustmentInput = { id: string; date: string; reason: string; amount: string };
export type TaxContext = {
  rules: TaxRule[];
  facts: PartnerTaxFacts;
  /** The instant the rules are read at: the end of the statement's period. */
  at: string;
  /** What the partner earned earlier in the same financial year, as an exact decimal string. "0" when this statement starts the year or stands alone. */
  priorBase: string;
};

export type StatementInput = {
  lines: StatementLineInput[];
  adjustments: StatementAdjustmentInput[];
  /** The figures stored on the payout row, if there is one, to check this working against. */
  stored: { totalAccrual: string; adjustment: string; net: string } | null;
  /** Absent means no rules are configured. */
  tax?: TaxContext | null;
};

export const STATEMENT_ASSUMPTIONS = [
  "Amounts are commission accruals worked out by the earnings engine, in rupees.",
  "Tax lines come only from rules Finance has configured. Where no tax rules are configured, nothing is deducted and no TDS or GST is shown.",
  "No money is moved by this system. The payable is an estimate until it is reconciled against the finance system.",
  "Each line is rounded to the paisa for display. The total is rounded once from the exact figures; any difference is the Rounding line.",
];

export type TaxLineView = { kind: "TDS" | "GST"; ruleId: string; label: string; ruleText: string; rate: string; base: string; running: string | null; amount: string; effect: string; memo: boolean; thresholdPassed: boolean };

/** Formats a tax result for screen, CSV and print. Amounts are strings with two decimals; `effect` is signed (what it does to the payable). */
function taxView(t: TaxResult) {
  return {
    state: t.state,
    lines: t.lines.map<TaxLineView>((l) => ({
      kind: l.kind,
      ruleId: l.ruleId,
      label: l.label,
      ruleText: l.ruleText,
      rate: l.rate,
      base: formatPaise(l.basePaise),
      running: l.runningPaise === null ? null : formatPaise(l.runningPaise),
      amount: formatPaise(l.amountPaise),
      effect: formatPaise(l.effectPaise),
      memo: l.memo,
      thresholdPassed: l.thresholdPassed,
    })),
    conflicts: t.conflicts,
    missing: t.missing,
    note: TAX_NOTE,
    rounding: ROUNDING_RULE,
  };
}

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

  // Tax is worked out on the exact net (before display rounding of single lines), never on rounded figures.
  const exactNet = sumUnits(lines.map((l) => l.units)) + adjustments.reduce((acc, a) => acc + parseUnits(a.amount), BigInt(0));
  const taxResult = input.tax
    ? applyTax({ rules: input.tax.rules, facts: input.tax.facts, at: new Date(input.tax.at), baseUnits: exactNet, priorUnits: parseUnits(input.tax.priorBase) })
    : applyTax({ rules: [], facts: { partnerType: "", hasPan: false, hasGstin: false }, at: new Date(0), baseUnits: exactNet, priorUnits: BigInt(0) });
  const payablePaise = netPaise + taxResult.effectPaise;

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
    tax: taxView(taxResult),
    payablePaise,
    payable: formatPaise(payablePaise),
    negativePayable: payablePaise < BigInt(0),
    stored,
    assumptions: STATEMENT_ASSUMPTIONS,
  };
}

export type Statement = ReturnType<typeof buildStatement>;


export type CumulativeInput = {
  /** The months to show, oldest first. accruals and adjustments are exact decimal strings. */
  months: { key: string; accruals: string; adjustments: string }[];
  /** What was earned in the financial year before the first month shown. */
  priorBase: string;
  tax: { rules: TaxRule[]; facts: PartnerTaxFacts };
};

/**
 * The financial year to date, one row per month with a running total and the tax carried month by month, for a tax return.
 * Each month's rules are read at the end of that month. The months add up to the tax on the year's total, to the paisa.
 */
export function buildCumulativeStatement(input: CumulativeInput) {
  let running = parseUnits(input.priorBase);
  let taxState: TaxResult["state"] = input.tax.rules.length === 0 ? "not_configured" : "no_match";
  const rows = input.months.map((m) => {
    const range = monthRange(m.key);
    if (!range) throw new Error("Not a month key");
    const base = parseUnits(m.accruals) + parseUnits(m.adjustments);
    const t = applyTax({ rules: input.tax.rules, facts: input.tax.facts, at: new Date(range.end.getTime() - 1), baseUnits: base, priorUnits: running });
    running += base;
    if (t.state === "conflict" || (t.state === "applied" && taxState !== "conflict")) taxState = t.state;
    const tds = t.lines.find((l) => l.kind === "TDS");
    const gst = t.lines.find((l) => l.kind === "GST");
    return {
      month: m.key,
      accruals: formatPaise(roundToPaise(parseUnits(m.accruals))),
      adjustments: formatPaise(roundToPaise(parseUnits(m.adjustments))),
      base: formatPaise(roundToPaise(base)),
      running: formatPaise(roundToPaise(running)),
      tdsPaise: tds?.amountPaise ?? BigInt(0),
      gstPaise: gst?.amountPaise ?? BigInt(0),
      gstMemo: gst?.memo ?? false,
      tds: formatPaise(tds?.amountPaise ?? BigInt(0)),
      gst: formatPaise(gst?.amountPaise ?? BigInt(0)),
    };
  });
  const sumBase = input.months.reduce((acc, m) => acc + parseUnits(m.accruals) + parseUnits(m.adjustments), BigInt(0));
  const tdsTotal = rows.reduce((acc, r) => acc + r.tdsPaise, BigInt(0));
  const gstTotal = rows.reduce((acc, r) => acc + r.gstPaise, BigInt(0));
  return {
    rows,
    taxState,
    totals: { base: formatPaise(roundToPaise(sumBase)), tds: formatPaise(tdsTotal), gst: formatPaise(gstTotal) },
    note: TAX_NOTE,
    rounding: ROUNDING_RULE,
  };
}
