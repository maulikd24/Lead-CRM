import { parseRate } from "../native/money";
import { planRuleChange, type RuleAdapter, type RuleChange } from "../rule-plan";

/**
 * Override rules: a percentage of a sub-partner's commission accrual, paid to the partner `level` steps above them in the
 * commercial roll-up, with an optional cap per accrual and effective dates. None exist by default, and nothing here has a default rate.
 */
export const MAX_OVERRIDE_LEVEL = 5;

export type OverrideRule = {
  id: string;
  level: number;
  /** Percentage as typed, at most four decimals. */
  ratePercent: string;
  /** Rupees, at most two decimals; null means no cap. */
  capPerAccrual: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;

function readDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = v.trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(t) ? Date.parse(`${t}T00:00:00.000Z`) - IST_OFFSET_MS : Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export type OverrideValidation = { ok: true; rule: Omit<OverrideRule, "id"> } | { ok: false; errors: string[] };

export function validateOverrideRule(input: Record<string, unknown>): OverrideValidation {
  const errors: string[] = [];
  const levelNum = typeof input.level === "number" ? input.level : typeof input.level === "string" && /^\d+$/.test(input.level.trim()) ? Number(input.level.trim()) : NaN;
  if (!Number.isInteger(levelNum) || levelNum < 1 || levelNum > MAX_OVERRIDE_LEVEL) errors.push(`The level is a whole number from 1 (the direct parent) to ${MAX_OVERRIDE_LEVEL}.`);

  const ratePercent = typeof input.ratePercent === "string" ? input.ratePercent.trim() : "";
  try {
    if (parseRate(ratePercent) === BigInt(0)) throw new Error("zero");
  } catch {
    errors.push("Type the rate as a percentage above 0 and up to 100, with at most four decimals. There is no default rate.");
  }

  let capPerAccrual: string | null = null;
  const cap = typeof input.capPerAccrual === "string" ? input.capPerAccrual.trim() : "";
  if (cap) {
    if (!AMOUNT.test(cap) || Number(cap) <= 0) errors.push("The cap is a positive amount in rupees with at most two decimals, or leave it blank for no cap.");
    else capPerAccrual = cap;
  }

  const effectiveFrom = readDate(input.effectiveFrom);
  if (!effectiveFrom) errors.push("Give the date the rule starts.");
  const endRaw = input.effectiveTo;
  const effectiveTo = endRaw === undefined || endRaw === null || endRaw === "" ? null : readDate(endRaw);
  if (endRaw !== undefined && endRaw !== null && endRaw !== "" && !effectiveTo) errors.push("The end date is not a date.");
  if (effectiveFrom && effectiveTo && Date.parse(effectiveTo) <= Date.parse(effectiveFrom)) errors.push("The end date must be after the start date.");

  if (errors.length || !effectiveFrom) return { ok: false, errors };
  return { ok: true, rule: { level: levelNum, ratePercent, capPerAccrual, effectiveFrom, effectiveTo } };
}

/** The id of an existing rule for the same level whose dates overlap the candidate's, or null. One rule per level at a time. */
export function findOverrideOverlap(existing: OverrideRule[], candidate: OverrideRule, ignoreId?: string): string | null {
  const cs = Date.parse(candidate.effectiveFrom);
  const ce = candidate.effectiveTo === null ? Infinity : Date.parse(candidate.effectiveTo);
  for (const r of existing) {
    if (r.id === ignoreId || r.id === candidate.id || r.level !== candidate.level) continue;
    const re = r.effectiveTo === null ? Infinity : Date.parse(r.effectiveTo);
    if (cs < re && Date.parse(r.effectiveFrom) < ce) return r.id;
  }
  return null;
}

const day = (iso: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));

export function describeOverrideRule(r: OverrideRule): string {
  const cap = r.capPerAccrual ? `capped at ₹${new Intl.NumberFormat("en-IN").format(Number(r.capPerAccrual))} per accrual` : "no cap";
  return `Override at level ${r.level}: ${Number(r.ratePercent)}% of the sub-partner's commission accrual, ${cap}. Effective ${day(r.effectiveFrom)}${r.effectiveTo ? ` until ${day(r.effectiveTo)}` : ""}`;
}

const adapter: RuleAdapter<OverrideRule, Omit<OverrideRule, "id">> = {
  noun: "override rule",
  validate: (raw) => validateOverrideRule(raw),
  overlap: (existing, candidate, ignoreId) => findOverrideOverlap(existing, candidate, ignoreId),
  describe: (r) => describeOverrideRule(r),
};

export function planOverrideRuleChange(change: RuleChange, existing: OverrideRule[], now: Date) {
  return planRuleChange(change, existing, now, adapter);
}
