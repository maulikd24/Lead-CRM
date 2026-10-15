import { checkCopy } from "@/lib/agents/guardrails";
import { AD_COPY_RULES } from "@/lib/marketing/social/compliance";

/**
 * checkAdCopy: the planner's ONE call into the canonical safety layer for marketing text (a promise hook, an allowed claim, a copy draft).
 *
 * SEAM. Today this wraps the base guardrails (`checkCopy`: guaranteed returns, advice, performance claims, echoed identifiers, length) and the ad
 * rules the social module already owns (urgency, superlatives, hype). The creative branch is extending the canonical guardrails module with a
 * shared `checkAdCopy`; at integration, replace the body of `checkAdCopy` below with a call to that function and keep this signature. Nothing
 * else in the planner imports the agent guardrails (ad-copy.test.ts pins that), so the swap is one file.
 */
export const AD_COPY_BASE = "agents/guardrails.checkCopy";

export type AdCopyIssueCode = "EMPTY" | "TOO_LONG" | "RETURN_PROMISE" | "ADVICE" | "PERFORMANCE_CLAIM" | "PII_ECHO" | "URGENCY" | "SUPERLATIVE" | "HYPE";
export type AdCopyIssue = { code: AdCopyIssueCode; message: string };
export type AdCopyResult = { ok: boolean; issues: AdCopyIssue[] };

export function checkAdCopy(text: string, opts: { maxChars: number }): AdCopyResult {
  const issues: AdCopyIssue[] = [];
  const add = (code: AdCopyIssueCode, message: string) => {
    if (!issues.some((i) => i.code === code)) issues.push({ code, message });
  };
  const body = text ?? "";
  const base = checkCopy(body, opts.maxChars);
  if (!base.ok) {
    const code = base.code as AdCopyIssueCode;
    add(code, code === "TOO_LONG" ? `Too long (limit ${opts.maxChars} characters).` : code === "EMPTY" ? "The copy is empty." : `Safety check: the text ${base.detail}.`);
  }
  if (body.trim()) for (const rule of AD_COPY_RULES) if (rule.re.test(body)) add(rule.code as AdCopyIssueCode, rule.message);
  return { ok: issues.length === 0, issues };
}

/** The pattern of one ad rule, for checks that need to know why a rule fired (the promise checklist). */
export const adRulePattern = (code: "URGENCY" | "SUPERLATIVE" | "HYPE"): RegExp => AD_COPY_RULES.find((r) => r.code === code)!.re;
