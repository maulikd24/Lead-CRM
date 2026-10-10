import { istDay } from "./format";
import { formatPaise, parseUnits, roundToPaise } from "./money";

/**
 * Explains how one commission accrual was computed, from the rule (and slab) it was matched to. It mirrors the rule
 * engine in src/lib/earnings/compute-accruals.ts and recomputes the amount from the exact figures, so a reader can
 * see the working and whether the stored amount still agrees with the rule as it stands. Pure.
 */
export type ExplainSlab = { minAmount: string; maxAmount: string | null; rate: string };
export type ExplainRule = {
  rateType: "PERCENT_OF_GROSS" | "PERCENT_OF_NET" | "FLAT_PER_TRANSACTION" | "SLAB";
  percentRate: string | null;
  flatRate: string | null;
  productCategory: string | null;
  transactionType: string | null;
  validFrom: string;
  validTo: string | null;
  slabs: ExplainSlab[];
};
export type ExplainInput = {
  storedAmount: string;
  grossRevenue: string;
  revenueType: string;
  eventDate: string;
  computationVersion: string;
  rule: ExplainRule | null;
  planName: string | null;
};
export type Explanation = {
  kind: "percent" | "flat" | "slab" | "none";
  headline: string;
  steps: string[];
  /** The amount worked out from the rule, in rupees with two places; null when it cannot be worked out. */
  recomputed: string | null;
  /** Whether the recomputed amount equals the stored one to the paisa; null when there was nothing to compare. */
  matches: boolean | null;
  note: string | null;
  slabs: { label: string; rate: string; applied: boolean }[] | null;
};

const RATE_SCALE = 10n ** 8n;
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const money = (units: bigint) => formatPaise(roundToPaise(units));
const date = istDay;

/** gross * rate / 100 on exact units, half up. */
function percentOf(grossUnits: bigint, rateUnits: bigint): bigint {
  const num = grossUnits * rateUnits;
  const den = 100n * RATE_SCALE;
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (abs + den / 2n) / den;
  return neg ? -q : q;
}

export function explainAccrual(input: ExplainInput): Explanation {
  const { rule } = input;
  if (!rule) {
    return { kind: "none", headline: "No rule on file for this accrual", steps: ["The accrual has no commission rule attached, so its working cannot be shown."], recomputed: null, matches: null, note: null, slabs: null };
  }
  const gross = parseUnits(input.grossRevenue);
  const stored = roundToPaise(parseUnits(input.storedAmount));
  const scope = `${rule.productCategory ? `${title(rule.productCategory)} products` : "all product categories"}, ${rule.transactionType ? `${title(rule.transactionType)} transactions` : "all transaction types"}`;
  const steps: string[] = [
    `Revenue event: ${title(input.revenueType)} of ${money(gross)} on ${date(input.eventDate)}.`,
    `Rule${input.planName ? ` in ${input.planName}` : ""}: applies to ${scope}, from ${date(rule.validFrom)}${rule.validTo ? ` to ${date(rule.validTo)}` : ""}. Where several rules match, the most specific one is used.`,
  ];

  let kind: Explanation["kind"] = "percent";
  let headline = "";
  let recomputedUnits: bigint | null = null;
  let slabs: Explanation["slabs"] = null;

  if (rule.rateType === "FLAT_PER_TRANSACTION") {
    kind = "flat";
    if (rule.flatRate !== null) {
      recomputedUnits = parseUnits(rule.flatRate);
      headline = `Flat ${money(recomputedUnits)} per transaction`;
      steps.push(`The rule pays a flat amount per transaction, whatever the revenue.`);
    }
  } else if (rule.rateType === "SLAB") {
    kind = "slab";
    const rows = rule.slabs.map((s) => ({ s, min: parseUnits(s.minAmount), max: s.maxAmount === null ? null : parseUnits(s.maxAmount) }));
    // Same test as the engine: minimum inclusive, maximum exclusive, first match wins.
    const hit = rows.find((r) => r.min <= gross && (r.max === null || gross < r.max));
    slabs = rows.map((r) => ({ label: r.max === null ? `${money(r.min)} and above` : `${money(r.min)} to under ${money(r.max)}`, rate: r.s.rate, applied: r === hit }));
    if (hit) {
      const label = slabs[rows.indexOf(hit)].label;
      recomputedUnits = percentOf(gross, parseUnits(hit.s.rate));
      headline = `${hit.s.rate}% (slab ${label}) of gross revenue ${money(gross)} = ${money(recomputedUnits)}`;
      steps.push(`The rule is tiered: the revenue of ${money(gross)} falls in the slab ${label}, which pays ${hit.s.rate}% of the whole amount.`);
    } else {
      headline = `No slab covers gross revenue ${money(gross)}`;
      steps.push("The rule is tiered but no slab covers this amount, so the working cannot be reproduced.");
    }
  } else {
    if (rule.percentRate !== null) {
      recomputedUnits = percentOf(gross, parseUnits(rule.percentRate));
      headline = `${rule.percentRate}% of gross revenue ${money(gross)} = ${money(recomputedUnits)}`;
      steps.push(rule.rateType === "PERCENT_OF_NET" ? `The rule is described as a percentage of net revenue, but the engine applies it to the gross figure, as shown here.` : `The rule pays ${rule.percentRate}% of gross revenue.`);
    }
  }

  const recomputed = recomputedUnits === null ? null : money(recomputedUnits);
  const matches = recomputedUnits === null ? null : roundToPaise(recomputedUnits) === stored;
  if (recomputed !== null) steps.push(`Worked out on exact figures and rounded once to paise: ${recomputed}. Stored amount: ${formatPaise(stored)}.`);
  const note = matches === false ? "The stored amount differs from the rule as it stands now. The rule has changed since this was calculated, or it was adjusted. The stored amount is the one paid." : null;
  return { kind, headline: headline || "The working cannot be reproduced", steps, recomputed, matches, note, slabs };
}
