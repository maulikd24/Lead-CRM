/**
 * The public surface of the copy guardrails for other modules. checkAdCopy() is the ONE ad copy check: it extends the canonical agent
 * guardrails (lib/agents/guardrails) additively. Creative drafts call it today; the campaign planner and the social drafter call it next.
 */
export {
  AD_COPY_EXTENSIONS, DEFAULT_DISCLAIMER, DEFAULT_PAST_PERFORMANCE, DEFAULT_RULE_SETTINGS, checkAdCopy, checkAdCtaFormula, failedChecks,
  type CopyLanguage, type RuleCheck, type RuleId, type RuleResult, type RuleSettings, type RuleStatus,
} from "./ad-copy";
