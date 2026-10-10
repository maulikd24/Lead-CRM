import { parseRate, parseUnits, ratePaise } from "../native/money";
import { describeRule, pickRule, type PartnerTaxFacts, type TaxKind, type TaxRule } from "./rules";

/**
 * Tax on a partner statement, worked out from the rules Finance configured. Pure exact-integer maths (the same BigInt units
 * as the statement), no floating point, no default rate. With no rule there is no tax line and nothing is deducted.
 */
export const ROUNDING_RULE = "Each tax line is worked out from the exact amounts and rounded once to the nearest paisa, halves away from zero. Tax on the financial year to date is worked out on the running total, so each statement carries only the difference from the one before.";
export const TAX_NOTE = "Tax rules are configured by Finance. Confirm with your tax adviser.";

export type TaxLine = {
  kind: TaxKind;
  ruleId: string;
  label: string;
  /** The exact rule used, in words. */
  ruleText: string;
  rate: string;
  /** The tax amount for this statement in paise: positive is tax charged, negative is tax given back. */
  amountPaise: bigint;
  /** How this line changes what the partner is paid, in paise (TDS is negative, a partner-invoiced GST is positive, a memo line is zero). */
  effectPaise: bigint;
  /** True for a line that is shown but does not change the payable (reverse charge, self-invoice). */
  memo: boolean;
  /** TDS: whether the running total for the financial year has passed the threshold (always true when there is none). */
  thresholdPassed: boolean;
  /** The amount the tax was worked out on: this statement's base, in paise. */
  basePaise: bigint;
  /** TDS: the financial year's running total including this statement, in paise. */
  runningPaise: bigint | null;
};

export type TaxResult = {
  state: "not_configured" | "no_match" | "conflict" | "applied";
  lines: TaxLine[];
  effectPaise: bigint;
  conflicts: { kind: TaxKind; ruleIds: string[] }[];
  /** Kinds with no rule for this partner, shown so the gap is visible rather than read as zero tax. */
  missing: TaxKind[];
};

const ZERO = BigInt(0);
const UNITS_PER_PAISE = BigInt(1000000);
const KINDS: TaxKind[] = ["TDS", "GST"];

function tdsOn(units: bigint, rate: bigint, threshold: bigint | null): bigint {
  if (units <= ZERO) return ZERO;
  if (threshold !== null && units <= threshold) return ZERO;
  return ratePaise(units, rate);
}

/** The base in paise, rounded once for display. */
function basePaiseOf(units: bigint): bigint {
  const neg = units < ZERO;
  const q = ((neg ? -units : units) + UNITS_PER_PAISE / BigInt(2)) / UNITS_PER_PAISE;
  return neg ? -q : q;
}

export function applyTax(input: { rules: TaxRule[]; facts: PartnerTaxFacts; at: Date; baseUnits: bigint; priorUnits: bigint }): TaxResult {
  const { rules, facts, at, baseUnits, priorUnits } = input;
  if (rules.length === 0) return { state: "not_configured", lines: [], effectPaise: ZERO, conflicts: [], missing: [] };

  const lines: TaxLine[] = [];
  const conflicts: TaxResult["conflicts"] = [];
  const missing: TaxKind[] = [];
  for (const kind of KINDS) {
    const pick = pickRule(rules, kind, facts, at);
    if (pick.status === "none") {
      missing.push(kind);
      continue;
    }
    if (pick.status === "conflict") {
      conflicts.push({ kind, ruleIds: pick.ruleIds });
      continue;
    }
    const r = pick.rule;
    const rate = parseRate(r.ratePercent);
    if (kind === "TDS") {
      const threshold = r.thresholdAmount === null ? null : parseUnits(r.thresholdAmount);
      const running = priorUnits + baseUnits;
      const before = tdsOn(priorUnits, rate, threshold);
      const after = tdsOn(running, rate, threshold);
      const amount = after - before;
      lines.push({
        kind,
        ruleId: r.id,
        label: r.label,
        ruleText: describeRule(r),
        rate: `${Number(r.ratePercent)}%`,
        amountPaise: amount,
        effectPaise: -amount,
        memo: false,
        thresholdPassed: threshold === null ? running > ZERO : running > threshold,
        basePaise: basePaiseOf(baseUnits),
        runningPaise: basePaiseOf(running),
      });
    } else {
      const amount = baseUnits > ZERO ? ratePaise(baseUnits, rate) : ZERO;
      const adds = r.gstMode === "PARTNER_INVOICED";
      lines.push({
        kind,
        ruleId: r.id,
        label: r.label,
        ruleText: describeRule(r),
        rate: `${Number(r.ratePercent)}%`,
        amountPaise: amount,
        effectPaise: adds ? amount : ZERO,
        memo: !adds,
        thresholdPassed: true,
        basePaise: basePaiseOf(baseUnits),
        runningPaise: null,
      });
    }
  }
  const effectPaise = lines.reduce((acc, l) => acc + l.effectPaise, ZERO);
  const state: TaxResult["state"] = conflicts.length ? "conflict" : lines.length ? "applied" : "no_match";
  return { state, lines, effectPaise, conflicts, missing };
}
