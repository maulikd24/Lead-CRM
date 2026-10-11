import { toRuleSettings, type BrandProfile } from "./brand";
import { checkFieldLimits, variantText, type FieldValues, type FormatKey } from "./formats";
import { similarityToReferences } from "./competitor";
import { checkAdCopy, type CopyLanguage, type RuleCheck } from "@/lib/guardrails";
import { scoreVariant, type RubricResult, type Verdict } from "./rubric";

/**
 * One call that runs everything a variant is judged on: the field limits, the shared SEBI and AMFI rules, the originality
 * check against attached competitor references, and the scoring rubric. The result is what the checklist shows and what
 * the workflow gates on (compliance_status). Pure; the server runs it again at every gate, on the text as saved.
 */

export type VariantEvaluation = { complianceStatus: "PASS" | "FAIL"; checks: RuleCheck[]; score: number; verdict: Verdict; rubric: RubricResult };

export function evaluateVariant(input: { format: FormatKey; fields: FieldValues; disclaimer: string; language: CopyLanguage; topic: string; profile: BrandProfile; referenceCopies: string[] }): VariantEvaluation {
  const text = variantText(input.format, input.fields, input.disclaimer);
  const rules = checkAdCopy({ text, language: input.language, settings: toRuleSettings(input.profile) });
  const checks: RuleCheck[] = [...rules.checks];

  const limits = checkFieldLimits(input.format, input.fields);
  checks.push(limits.ok ? { id: "within_limits", label: "Within the channel's character limits", status: "pass", message: "Every field is within the channel limits." } : { id: "within_limits", label: "Within the channel's character limits", status: "fail", matched: limits.issues[0].message, message: limits.issues.map((i) => i.message).join(" ") });

  if (input.referenceCopies.length === 0) checks.push({ id: "originality", label: "Original wording", status: "not_applicable", message: "No competitor reference is attached." });
  else {
    // Judged field by field, so a short echoed line is not diluted by the rest of the ad.
    const sim = Object.values(input.fields).flat().map((v) => similarityToReferences(v, input.referenceCopies)).reduce((a, b) => (b.score > a.score ? b : a), { tooSimilar: false, score: 0 });
    checks.push(sim.tooSimilar ? { id: "originality", label: "Original wording", status: "fail", matched: `${Math.round(sim.score * 100)}% of the wording matches a reference`, message: "The copy echoes a competitor reference. Competitor ads are inspiration only: write it in your own words." } : { id: "originality", label: "Original wording", status: "pass", message: "The wording is the firm's own." });
  }

  const complianceStatus = checks.some((c) => c.status === "fail") ? "FAIL" : "PASS";
  const rubric = scoreVariant({ format: input.format, fields: input.fields, disclaimer: input.disclaimer, language: input.language, topic: input.topic, compliance: { status: complianceStatus, checks } });
  return { complianceStatus, checks, score: rubric.score, verdict: rubric.verdict, rubric };
}
