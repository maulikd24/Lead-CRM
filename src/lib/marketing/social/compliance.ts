import { checkCopy } from "@/lib/agents/guardrails";

/**
 * Compliance check for social post drafts of a SEBI-regulated firm. Pure.
 *
 * Layer 1 is the agent safety layer's regex guardrails (guaranteed returns, advice, performance claims, in English,
 * Hinglish and Hindi), reused as is. Layer 2 adds the ad-copy rules that matter for public posts: no urgency or
 * pressure, no unverifiable superlatives, no get-rich hype, no unresolved placeholders, and the mandatory
 * disclosures (a market-risk statement and a SEBI registration line). Fail closed: a false positive costs one edit,
 * a false negative is a regulatory problem, so every issue here blocks approval.
 *
 * This is a safety net, not a compliance review. A human still approves every post, and the exact disclosure wording
 * must be confirmed by the firm's compliance officer (see STANDARD_RISK_LINE below).
 */

/** Channels with a post limit that can hold the mandatory disclosures. X is left out on purpose: 280 characters cannot. */
export const SOCIAL_CHANNELS = {
  linkedin: { label: "LinkedIn", maxLength: 3000 },
  instagram: { label: "Instagram", maxLength: 2200 },
  facebook: { label: "Facebook", maxLength: 5000 },
  youtube: { label: "YouTube", maxLength: 5000 },
} as const;

export type SocialChannel = keyof typeof SOCIAL_CHANNELS;

export function isSocialChannel(value: unknown): value is SocialChannel {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SOCIAL_CHANNELS, value);
}

/** The standard market-risk statement. Compliance must confirm this wording before the feature is used for real posts. */
export const STANDARD_RISK_LINE = "Investments in securities markets are subject to market risks. Read all related documents carefully before investing.";

/** Inserted, never filled in: the registration line carries real registration numbers that only the firm can supply. */
export const REGISTRATION_PLACEHOLDER = "[REGISTRATION LINE: entity name, SEBI registration category and number - CONFIRM]";

export type IssueCode =
  | "EMPTY"
  | "TOO_LONG"
  | "RETURN_PROMISE"
  | "ADVICE"
  | "PERFORMANCE_CLAIM"
  | "URGENCY"
  | "SUPERLATIVE"
  | "HYPE"
  | "PLACEHOLDER"
  | "MISSING_RISK_STATEMENT"
  | "MISSING_REGISTRATION"
  | "UNKNOWN_CHANNEL";

export type ComplianceIssue = { code: IssueCode; message: string };
export type ComplianceResult = { ok: boolean; issues: ComplianceIssue[] };

const URGENCY = /\b(?:last\s+chance|don['’]?t\s+miss\s+out|hurry|act\s+now|limited\s+(?:time|period|seats?|slots?|offer)|only\s+\d+\s+(?:seats?|slots?|spots?)\s+left|before\s+it['’]?s\s+too\s+late|ends?\s+(?:today|tonight|soon)|fomo)\b/i;
const SUPERLATIVE = /\b(?:best|safest|number\s+(?:one|1)|no\.?\s?1|#\s?1|unbeatable|unmatched|unrivall?ed)\b/i;
const HYPE = /\b(?:easy\s+money|free\s+money|get\s+rich|quick\s+(?:profits?|money)|secret|insiders?)\b/i;
const PLACEHOLDER = /\[[^\]\n]*[A-Za-z][^\]\n]*\]/;
const RISK_STATEMENT = /subject\s+to\s+market\s+risks?/i;
const REGISTRATION_ID = /\b[A-Z]{2,5}[A-Z0-9/-]*\d{6,}[A-Z0-9/-]*\b/;

const RULES: { code: IssueCode; re: RegExp; message: string }[] = [
  { code: "URGENCY", re: URGENCY, message: "Uses urgency or pressure wording. Educate first; do not pressure." },
  { code: "SUPERLATIVE", re: SUPERLATIVE, message: "Makes an unverifiable superlative claim (best, safest, number one)." },
  { code: "HYPE", re: HYPE, message: "Uses get-rich or insider wording." },
  { code: "PLACEHOLDER", re: PLACEHOLDER, message: "Contains an unresolved [placeholder]. A person must fill it in before this can be approved." },
];

const GUARDRAIL_CODES = new Set<IssueCode>(["EMPTY", "TOO_LONG", "RETURN_PROMISE", "ADVICE", "PERFORMANCE_CLAIM"]);

export function checkPost(input: { channel: string; body: string }): ComplianceResult {
  const issues: ComplianceIssue[] = [];
  const add = (code: IssueCode, message: string) => {
    if (!issues.some((i) => i.code === code)) issues.push({ code, message });
  };

  if (!isSocialChannel(input.channel)) {
    add("UNKNOWN_CHANNEL", "This channel is not supported for drafts.");
    return { ok: false, issues };
  }
  const { label, maxLength } = SOCIAL_CHANNELS[input.channel];
  const body = input.body ?? "";

  const guard = checkCopy(body, maxLength);
  if (!guard.ok && GUARDRAIL_CODES.has(guard.code as IssueCode)) {
    add(guard.code as IssueCode, guard.code === "TOO_LONG" ? `Too long for ${label} with the mandatory disclosures (limit ${maxLength} characters).` : `Safety check: ${guard.detail}.`);
  }
  if (body.trim()) {
    for (const rule of RULES) if (rule.re.test(body)) add(rule.code, rule.message);
    if (!RISK_STATEMENT.test(body)) add("MISSING_RISK_STATEMENT", "The market-risk statement is missing. Use 'Insert required disclosures'.");
    // The inserted placeholder is already reported as an unresolved placeholder; do not report the same gap twice.
    const registered = /\bSEBI\b/i.test(body) && /\bregistration\b|\breg\.?\s*no|\bregn?\b/i.test(body) && REGISTRATION_ID.test(body);
    if (!registered && !body.includes(REGISTRATION_PLACEHOLDER)) {
      add("MISSING_REGISTRATION", "A SEBI registration line with the registration number is missing.");
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Every rule here blocks approval; the helper exists so callers do not need to know that. */
export function hasBlockingIssue(result: ComplianceResult): boolean {
  return result.issues.length > 0;
}

/** Adds the risk line and, unless a registration line is already present, a registration placeholder. Idempotent. */
export function appendRequiredDisclosures(body: string): string {
  let out = body.trimEnd();
  if (!RISK_STATEMENT.test(out)) out += `\n\n${STANDARD_RISK_LINE}`;
  const hasRegistration = /\bSEBI\b/i.test(out) && REGISTRATION_ID.test(out);
  if (!hasRegistration && !out.includes(REGISTRATION_PLACEHOLDER)) out += `\n${REGISTRATION_PLACEHOLDER}`;
  return out;
}
