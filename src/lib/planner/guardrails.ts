import { STANDARD_RISK_LINE } from "@/lib/marketing/social/compliance";

import { adRulePattern, checkAdCopy } from "./ad-copy";

/**
 * The SEBI / ASCI checklist every promise passes, as a visible list of pass/fail items (never a single score).
 * Pure. It reuses the agent safety layer (guaranteed returns, advice, performance claims) and the social post rules
 * (urgency, superlatives, hype) so there is one definition of "unsafe wording" in the product.
 *
 * Fail closed: a false positive costs one edit. This is a safety net, not a compliance review.
 */

/** Added by code to every copy draft; the exact wording is for the compliance officer to confirm. */
export const DISCLAIMER_TEXT = STANDARD_RISK_LINE;
/** The one-line form for channels with very little room. */
export const SHORT_DISCLAIMER = "Investments are subject to market risks.";

export type PromiseInput = { hook: string; evidence: string; product: string; allowedClaims: string[]; disallowedClaims: string[] };
export type CheckItem = { id: string; label: string; status: "pass" | "fail"; detail: string };
export type PromiseCheck = { ok: boolean; items: CheckItem[] };

const URGENCY = adRulePattern("URGENCY");
const SCARCITY = /\b(?:only\s+\d+\s+(?:\w+\s+)?(?:left|remaining)|while\s+(?:stocks|seats|slots)\s+last|few\s+(?:seats|slots)\s+left|offer\s+ends)\b/i;
const SUPERLATIVE = adRulePattern("SUPERLATIVE");
const HYPE = adRulePattern("HYPE");

export function checkPromise(input: PromiseInput): PromiseCheck {
  const hook = (input.hook ?? "").trim();
  const claims = input.allowedClaims.map((c) => c.trim()).filter(Boolean);
  const texts = [hook, ...claims].filter(Boolean);
  const guard = (code: string) => {
    for (const t of texts) {
      const g = checkAdCopy(t, { maxChars: 5000 }).issues.find((i) => i.code === code);
      if (g) return g.message.replace(/^Safety check: the text /, "").replace(/\.$/, "");
    }
    return null;
  };
  const match = (re: RegExp) => texts.find((t) => re.test(t)) ?? null;

  const items: CheckItem[] = [];
  const add = (id: string, label: string, problem: string | null, passText: string) => items.push({ id, label, status: problem ? "fail" : "pass", detail: problem ?? passText });

  const returns = guard("RETURN_PROMISE") ?? guard("PERFORMANCE_CLAIM");
  add("no_guaranteed_returns", "No guaranteed or assured returns", !hook ? "The hook is empty." : returns ? `The hook or an allowed claim ${returns}. Remove any guarantee, assured return or return figure.` : null, "No guarantee, assured return or return figure.");
  add("no_unsuitable_advice", "No unsuitable advice", guard("ADVICE") ? `The wording ${guard("ADVICE")}. Describe a tool or a process, not what to buy.` : null, "Does not tell anyone what to buy or sell.");
  add("no_urgency_or_scarcity", "No urgency or scarcity for investment products", match(URGENCY) || match(SCARCITY) ? "Uses urgency or scarcity wording. Educate first; do not pressure." : null, "No pressure or countdown wording.");
  add("no_hype_or_superlatives", "No hype or unverifiable superlatives", match(SUPERLATIVE) || match(HYPE) ? "Uses 'best', 'safest', get-rich or insider wording. Say what the tool does instead." : null, "No unverifiable superlatives or hype.");
  add("evidence_present", "Proof or evidence stated", (input.evidence ?? "").trim().length >= 10 ? null : "Write what proves the promise (what the tool actually does, what it needs).", "Evidence is written down.");
  add("claims_defined", "Allowed and disallowed claims listed", claims.length > 0 && input.disallowedClaims.some((c) => c.trim()) ? null : "List at least one allowed claim and one disallowed claim.", "Allowed and disallowed claims are listed.");
  add("disclaimer", "Mandatory disclaimer", /subject\s+to\s+market\s+risks?/i.test(DISCLAIMER_TEXT) && /subject\s+to\s+market\s+risks?/i.test(SHORT_DISCLAIMER) ? null : "The configured disclaimer is missing the market-risk statement.", "Added by the system to every copy draft.");
  return { ok: items.every((i) => i.status === "pass"), items };
}
