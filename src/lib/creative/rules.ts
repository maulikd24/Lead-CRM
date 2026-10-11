import { checkCopy } from "@/lib/agents/guardrails";
import { STANDARD_RISK_LINE } from "@/lib/marketing/social/compliance";

/**
 * Shared copy rules for every ad channel. Pure. One module, so a rule is changed once.
 *
 * This is the SEBI and AMFI rule block for a regulated Indian wealth firm: no guaranteed or assured returns, no
 * performance claims without the past-performance disclaimer, the risk disclosure present, no testimonials where they
 * are prohibited, no urgency or scarcity for investment products, no advice, no unverifiable superlatives or numbers.
 * Plus an honesty rule (a number about clients, assets or ranking needs a named source) and a self-check on
 * placeholders and the firm's own banned words.
 *
 * Each rule gives pass, fail or not applicable, and a failing rule shows the exact phrase it matched. Fail closed: a
 * false positive costs one edit; a false negative is a regulatory problem. A person still approves every item. This is a
 * safety net and a checklist, not a compliance review: the firm's compliance officer owns the wording.
 */

export const DEFAULT_DISCLAIMER = STANDARD_RISK_LINE;
export const DEFAULT_PAST_PERFORMANCE = "Past performance may or may not be sustained in future.";

export type RuleSettings = {
  /** The mandatory risk disclosure. Configurable: the firm's compliance officer sets the exact words. */
  disclaimer: string;
  /** The disclaimer a performance claim must sit beside. */
  pastPerformanceDisclaimer: string;
  testimonialsProhibited: boolean;
  /** The firm's own banned words and phrases, matched whole-word and without regard to case. */
  bannedWords: string[];
  /** Claims that may only run with the full disclaimer next to them (for example a tax-saving claim). */
  regulatedClaims: string[];
};

export const DEFAULT_RULE_SETTINGS: RuleSettings = {
  disclaimer: DEFAULT_DISCLAIMER,
  pastPerformanceDisclaimer: DEFAULT_PAST_PERFORMANCE,
  testimonialsProhibited: true,
  bannedWords: ["multibagger", "jackpot", "hot tip", "stock tips"],
  regulatedClaims: [],
};

export type RuleId =
  | "not_empty"
  | "guaranteed_returns"
  | "performance_claims"
  | "advice"
  | "risk_disclosure"
  | "testimonials"
  | "urgency_scarcity"
  | "superlatives"
  | "hype"
  | "inducements"
  | "honesty"
  | "regulated_claims"
  | "banned_words"
  | "placeholders"
  | "safety_layer";

export type RuleStatus = "pass" | "fail" | "not_applicable";
export type RuleCheck = { id: RuleId; label: string; status: RuleStatus; /** The phrase that tripped the rule. */ matched?: string; message: string };
export type RuleResult = { status: "PASS" | "FAIL"; checks: RuleCheck[] };
export type CopyLanguage = "en" | "hinglish";

const AP = "['’]";
const RE = {
  guaranteed: new RegExp(String.raw`\b(?:guarantee(?:s|d|ing)?|assured\s+(?:\d|returns?|profits?|income|gains?|growth)|risk[\s-]*free|sure[\s-]*shot|sure[\s-]*fire|fixed\s+returns?|no\s+risk|zero\s+risk|without\s+(?:any\s+)?risk|capital\s+(?:is\s+)?(?:fully\s+)?protect\w*|100\s*%\s*(?:safe|secure)|(?:double|triple)\s+your\s+(?:money|investment)|never\s+lose|(?:can${AP}?t|cannot|won${AP}?t)\s+lose|pakka(?:\s+returns?|\s+profit|\s+munafa)?|ga(?:ra|ura)nt(?:ee|i|y)d?|(?:koi\s+)?risk\s+nahi|bina\s+risk|returns?\s+milega|nuksan\s+nahi|ek\s+dum\s+safe)(?![a-z])`, "i"),
  guaranteedHindi: /(गारंटी|गारन्टी|पक्का\s*रिटर्न|निश्चित\s*रिटर्न|जोखिम\s*(?:नहीं|मुक्त)|रिस्क\s*(?:फ्री|नहीं)|नुकसान\s*नहीं)/,
  performance: /\b\d{1,3}(?:\.\d+)?\s?%\s*(?:returns?|p\.?a\.?|annual(?:ly)?|annuali[sz]ed|cagr|xirr|irr)\b|\breturns?\s+of\s+(?:about\s+|around\s+|over\s+)?\d{1,3}(?:\.\d+)?\s?%|\b(?:delivered|gave|generated|returned|earned|yielded)\s+(?:you\s+)?\d{1,3}(?:\.\d+)?\s?%|\btop[\s-]performing\b|\boutperform\w*\s+(?:the\s+)?(?:market|benchmark|index)\b|\bbeat(?:s|ing)?\s+the\s+(?:market|benchmark|index)\b/i,
  advice: new RegExp(String.raw`\b(?:you\s+(?:should|must|need\s+to)\s+(?:buy|sell|invest)|(?:buy|sell|invest)\s+now|(?:i|we)(?:${AP}d|\s+would)?\s+(?:highly\s+)?recommend\b|recommended\s+for\s+you|must\s+(?:buy|sell|invest)|go\s+ahead\s+and\s+(?:invest|buy|sell)|(?:right|best|perfect)\s+time\s+to\s+(?:invest|buy|sell)|invest\s+kijiye|invest\s+kar\s+(?:do|lo|dijiye)|(?:paisa|paise)\s+lagao|kharid\s+lo|(?:we|i)\s+advise\s+you)`, "i"),
  riskPast: /past\s+performance\s+may\s+or\s+may\s+not\s+be\s+sustained/i,
  testimonial: /\btestimonials?\b|\b(?:happy|satisfied|delighted)\s+(?:client|customer|investor)s?\b|\b(?:our|my)\s+(?:clients?|customers?|investors?)\s+(?:say|love|trust|swear)\b|\bsays\s+[A-Z][a-z]+\b|\b\d(?:\.\d)?\s?\/\s?5\b|\b\d(?:\.\d)?\s?stars?\b|\bfive[\s-]star\b|[“"][^”"\n]{5,}[”"]\s*[-—–]\s*[A-Z]/i,
  urgency: /\b(?:last\s+chance|don['’]?t\s+miss(?:\s+out)?|hurry|act\s+now|limited\s+(?:time|period|seats?|slots?|offer|window)|only\s+\d+\s+(?:seats?|slots?|spots?)(?:\s+left)?|\d+\s+(?:seats?|slots?|spots?)\s+left|before\s+it['’]?s\s+too\s+late|ends?\s+(?:today|tonight|soon|this\s+week)|offer\s+ends|today\s+only|while\s+(?:stocks?|seats?)\s+last|fomo|jaldi(?:\s+karein)?|aakhri\s+mauka|sirf\s+aaj|turant|abhi\s+nahi\s+to)\b/i,
  superlative: /\b(?:best|safest|number\s+(?:one|1)|no\.?\s?1|#\s?1|unbeatable|unmatched|unrivall?ed|top[\s-]rated|india['’]?s\s+(?:leading|largest|most\s+trusted))\b/i,
  hype: /\b(?:easy\s+money|free\s+money|get\s+rich|quick\s+(?:profits?|money)|secret|insiders?|jackpot)\b/i,
  inducement: /\b(?:free\s+gifts?|cash[\s-]?back|bonus|gift\s+voucher|reward\s+for\s+(?:investing|opening)|lucky\s+draw)\b/i,
  unverifiable: /\b\d[\d,.]*\s*\+?\s*(?:k|lakh|lakhs|crore|crores|cr|million)?\+?\s*(?:happy\s+)?(?:clients?|customers?|investors?|families|users|members)\b|\b(?:aum|assets)\s+(?:of|worth)\s+(?:₹|rs\.?\s?)\s?\d|\b(?:ranked|rated)\s+(?:#?\s?\d|number|among|amongst)\b|\baward[\s-]winning\b/i,
  source: /\bsource\s*:/i,
  placeholder: /\[[^\]\n]*[A-Za-z][^\]\n]*\]/,
};

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Rule = { id: RuleId; label: string; message: string };

function check(r: Rule, matched: string | null | undefined, extra?: { passMessage?: string }): RuleCheck {
  if (matched) return { id: r.id, label: r.label, status: "fail", matched, message: r.message };
  return { id: r.id, label: r.label, status: "pass", message: extra?.passMessage ?? "No problem found." };
}

const first = (re: RegExp, text: string) => text.match(re)?.[0].trim() ?? null;

export function checkCopyRules(input: { text: string; language: CopyLanguage; settings?: RuleSettings }): RuleResult {
  const s = input.settings ?? DEFAULT_RULE_SETTINGS;
  const text = input.text ?? "";
  const checks: RuleCheck[] = [];
  const empty = !text.trim();
  checks.push(empty ? { id: "not_empty", label: "Has copy", status: "fail", message: "There is no copy to check." } : { id: "not_empty", label: "Has copy", status: "pass", message: "There is copy to check." });

  const guaranteed = first(RE.guaranteed, text) ?? first(RE.guaranteedHindi, text);
  checks.push(check({ id: "guaranteed_returns", label: "No guaranteed or assured returns", message: "Promises or implies guaranteed, assured, fixed or risk-free returns. SEBI and AMFI advertising rules do not allow this." }, guaranteed));

  const perf = first(RE.performance, text);
  const perfCovered = RE.riskPast.test(text) || (s.pastPerformanceDisclaimer.trim() !== "" && norm(text).includes(norm(s.pastPerformanceDisclaimer)));
  checks.push(check({ id: "performance_claims", label: "Performance claims carry the past-performance disclaimer", message: `Quotes or claims performance without "${s.pastPerformanceDisclaimer}". Add the disclaimer, a verifiable source and the period, or remove the claim.` }, perf && !perfCovered ? perf : null, { passMessage: perf ? "A performance claim is covered by the past-performance disclaimer. A person must still verify the figure and its source." : "No performance claim found." }));

  checks.push(check({ id: "advice", label: "No investment advice or recommendation", message: "Reads as advice or a recommendation to buy, sell or invest. Educate; do not advise." }, first(RE.advice, text)));

  const disclaimerPresent = s.disclaimer.trim() !== "" && norm(text).includes(norm(s.disclaimer));
  checks.push(disclaimerPresent ? { id: "risk_disclosure", label: "Risk disclosure present", status: "pass", message: "The mandatory risk disclosure is in the copy." } : { id: "risk_disclosure", label: "Risk disclosure present", status: "fail", message: `The mandatory risk disclosure is missing: "${s.disclaimer}"` });

  const testimonial = first(RE.testimonial, text);
  checks.push(s.testimonialsProhibited ? check({ id: "testimonials", label: "No testimonials", message: "Looks like a testimonial or customer endorsement, which is prohibited for this firm's advertising." }, testimonial) : { id: "testimonials", label: "No testimonials", status: "not_applicable", message: "Testimonials are allowed in this firm's settings." });

  checks.push(check({ id: "urgency_scarcity", label: "No urgency or scarcity tactics", message: "Uses urgency or scarcity wording. Do not pressure anyone about an investment product." }, first(RE.urgency, text)));
  checks.push(check({ id: "superlatives", label: "No unverifiable superlatives", message: "Makes an unverifiable claim such as best, safest or number one." }, first(RE.superlative, text)));
  checks.push(check({ id: "hype", label: "No get-rich or insider language", message: "Uses get-rich, secret or insider wording." }, first(RE.hype, text)));
  checks.push(check({ id: "inducements", label: "No gifts or bonuses for investing", message: "Offers a gift, cashback or bonus tied to investing. Do not use inducements." }, first(RE.inducement, text)));

  const unverifiable = first(RE.unverifiable, text);
  checks.push(check({ id: "honesty", label: "Honesty: numbers name their source", message: 'A number about clients, assets or rankings needs a named source in the copy, for example "Source: annual report 2026".' }, unverifiable && !RE.source.test(text) ? unverifiable : null));

  const claim = s.regulatedClaims.map((c) => c.trim()).filter(Boolean).map((c) => first(new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRe(c)}(?![\p{L}\p{N}])`, "iu"), text)).find(Boolean) ?? null;
  checks.push(s.regulatedClaims.length === 0 ? { id: "regulated_claims", label: "Regulated claims carry the disclaimer", status: "not_applicable", message: "No regulated-claims list is set in the brand profile." } : check({ id: "regulated_claims", label: "Regulated claims carry the disclaimer", message: "A regulated claim from the brand profile appears without the full mandatory disclaimer next to it." }, claim && !disclaimerPresent ? claim : null));

  const banned = s.bannedWords.map((w) => w.trim()).filter(Boolean).map((w) => first(new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRe(w)}(?![\p{L}\p{N}])`, "iu"), text)).find(Boolean) ?? null;
  checks.push(check({ id: "banned_words", label: "No banned words", message: "Uses a word or phrase on the firm's banned list." }, banned));
  checks.push(check({ id: "placeholders", label: "No unresolved placeholders", message: "Contains an unresolved [placeholder]. A person must fill it in first." }, first(RE.placeholder, text)));

  // The shared safety layer used by the messaging agents is a second net for promises, advice and personal identifiers.
  if (!empty) {
    const guard = checkCopy(text, 100_000);
    if (!guard.ok && (guard.code === "RETURN_PROMISE" || guard.code === "ADVICE" || guard.code === "PII_ECHO")) {
      const covered = (guard.code === "RETURN_PROMISE" && guaranteed) || (guard.code === "ADVICE" && first(RE.advice, text));
      if (!covered) checks.push({ id: "safety_layer", label: "Safety layer", status: "fail", matched: guard.detail, message: `The shared safety check says the copy ${guard.detail}.` });
    }
  }
  return { status: checks.some((c) => c.status === "fail") ? "FAIL" : "PASS", checks };
}

export const failedChecks = (r: RuleResult): RuleCheck[] => r.checks.filter((c) => c.status === "fail");

/**
 * The CTA formula: one clear action + what happens next + no pressure. Advisory (it never blocks approval): a CTA that is
 * missing, doubled or pushy is reported so the writer can fix it.
 */
export function checkCtaFormula(cta: string): { ok: boolean; note: string } {
  const text = cta.trim();
  if (!text) return { ok: false, note: "Add one call to action: a single verb and what happens next, for example: Book a 15-minute call." };
  if (RE.urgency.test(text)) return { ok: false, note: "Drop the pressure. A good call to action states the next step calmly." };
  const verbs = text.match(/\b(?:book|call|talk|learn|read|see|start|open|download|schedule|request|check|ask|get|join|explore|compare)\b/gi) ?? [];
  if (verbs.length > 2) return { ok: false, note: "One action per call to action. Pick the single next step." };
  if (verbs.length === 0) return { ok: false, note: "Begin with a clear verb (Book, Learn, Request, Compare) so the next step is obvious." };
  return { ok: true, note: "A clear, single next step." };
}
