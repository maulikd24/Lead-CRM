import { planRuleChange, type RuleAdapter, type RuleChange } from "../rule-plan";
import { describeRule, findOverlap, validateTaxRule, type TaxRule } from "./rules";

const adapter: RuleAdapter<TaxRule, Omit<TaxRule, "id">> = {
  noun: "tax rule",
  validate: (raw) => validateTaxRule(raw),
  overlap: (existing, candidate, ignoreId) => findOverlap(existing, candidate, ignoreId),
  describe: (r) => describeRule(r),
};

export type { RuleChange as TaxRuleChange };

/** What to write for a proposed tax rule change, or every reason it cannot be made. Pure. */
export function planTaxRuleChange(change: RuleChange, existing: TaxRule[], now: Date) {
  return planRuleChange(change, existing, now, adapter);
}
