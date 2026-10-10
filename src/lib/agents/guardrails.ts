export type GuardrailResult =
  | { ok: true }
  | { ok: false; code: "EMPTY" | "TOO_LONG" | "RETURN_PROMISE" | "ADVICE" | "PERFORMANCE_CLAIM" | "PII_ECHO"; detail: string };

export const MAX_AGENT_TEXT = 1000;

/**
 * Hard compliance guard for AI-drafted outbound WhatsApp text (SEBI-regulated firm).
 * Design stance: fail closed. A false positive costs one redraft; a false negative is a
 * regulatory breach. Deliberate choices (all covered by tests):
 *  - a bare "guarantee(d)" is blocked, even about documents, and even negated
 *    ("returns are not guaranteed"): risk disclaimers must come from approved templates;
 *  - "assured" only blocks when it qualifies returns ("assured returns", "assured 12%"),
 *    so "rest assured, we received your documents" passes;
 *  - "I recommend ..." is blocked unless it recommends a plain onboarding step
 *    (completing/uploading/submitting/checking/verifying/updating/finishing);
 *  - "invest now?" as a question is NOT blocked, only "buy now" / "sell now".
 * Rule order matters: RETURN_PROMISE rules run before PERFORMANCE_CLAIM so
 * "guaranteed 12% returns" is reported as a promise. Hinglish "pakka\s+returns?" precedes
 * bare "pakka" in the alternation.
 * Known gaps (regex-only, out of scope): Cyrillic/Greek homoglyphs, letter spacing ("g u a r a n t e e"),
 * leetspeak, unlisted spellings. Recommend an LLM-judge second layer later. `\b` does not work with Devanagari, so Hindi rules have none.
 */
const REC_EXEMPT = String.raw`(?!(?:completing|uploading|submitting|checking|verifying|updating|finishing)\b)`;
const AP = "['’]";

const RULES: { code: "RETURN_PROMISE" | "ADVICE" | "PERFORMANCE_CLAIM"; re: RegExp; detail: string }[] = [
  { code: "RETURN_PROMISE", re: /\b(guarantee(?:s|d|ing)?|assured\s+(?:\d|returns?|profits?|income|gains?|growth)|risk[\s-]*free|sure[\s-]*shot|fixed\s+returns?|no\s+risk|zero\s+risk|without\s+(?:any\s+)?risk)(?![a-z])/i, detail: "promises or guarantees returns" },
  { code: "RETURN_PROMISE", re: /\b100\s*%\s*(?:safe|secure|guaranteed|risk[\s-]*free)/i, detail: "claims 100% safety" },
  { code: "RETURN_PROMISE", re: /\b(?:double|triple)\s+your\s+(?:money|investment)\b/i, detail: "promises to multiply money" },
  { code: "RETURN_PROMISE", re: new RegExp(String.raw`\b(?:no\s+downside|capital\s+(?:is\s+)?(?:fully\s+)?protect\w*|principal\s+(?:amount\s+)?(?:is\s+)?(?:safe|secure|protected)|no\s+chance\s+of\s+(?:loss|losing)|loss[\s-]*proof|sure[\s-]*fire|never\s+(?:lost|lose)s?\s+(?:any\s+)?money|(?:can${AP}?t|cannot|won${AP}?t|will\s+not|will\s+never)\s+lose|you\s+will\s+(?:definitely|surely|certainly)\s+(?:earn|profit|gain|make)|sure\s+(?:profits?|returns?)|your\s+(?:money|funds|investment|capital)\s+(?:is|are)\s+(?:100\s*%\s*)?(?:safe|secure|protected)|(?:a\s+)?safe\s+investment|high\s+returns?\s+with\s+(?:low|minimal|no)\s+risk)`, "i"), detail: "promises safety or returns" },
  { code: "RETURN_PROMISE", re: /\b(?:pakka\s+(?:returns?|profit|munafa|fayda)|pakka|ga(?:ra|ura)nt(?:ee|i|y)d?)\b|\b(?:paisa|paise|money)\s+(?:double|dugna|dugana|doguna|dugni)\b/i, detail: "promises returns (Hinglish)" },
  { code: "RETURN_PROMISE", re: /\b(?:(?:koi\s+)?risk\s+nahi|bina\s+risk|ek\s+dum\s+safe|nuksan\s+nahi|loss\s+nahi|returns?\s+milega|profit\s+hi\s+profit|zaroor\s+(?:profit|munafa|nafa|fayda|returns?)|(?:munafa|nafa|fayda|profit)\s+(?:hi\s+)?hoga)/i, detail: "promises returns or no loss (Hinglish)" },
  { code: "RETURN_PROMISE", re: /(गारंटी|गारन्टी|पक्का\s*रिटर्न|निश्चित\s*रिटर्न|पैसा\s*(?:दोगुना|डबल|दुगना|दुगुना)|जोखिम\s*(?:नहीं|मुक्त)|रिस्क\s*(?:फ्री|नहीं)|(?:पक्का|पक्की|निश्चित)\s*(?:मुनाफ़?ा|फ़?ायदा)|रिटर्न\S*\s*मिलेगा|सुरक्षित\s*निवेश|(?:मुनाफ़?ा|फ़?ायदा)\s*(?:ही\s*)?होगा)/, detail: "promises returns (Hindi)" },
  { code: "ADVICE", re: new RegExp(String.raw`\b(?:you\s+(?:should|must|need\s+to)\s+(?:buy|sell|invest)|(?:i|we)(?:${AP}d|\s+would)?\s+(?:highly\s+)?recommend\s+${REC_EXEMPT}|recommended\s+for\s+you|best\s+(?:fund|scheme|pms|stock|plan)s?\s+for\s+you|you\s+should\s+consider\s+(?:investing|buying|selling)|go\s+ahead\s+and\s+(?:invest|buy|sell)|invest\s+now\s+before|(?:right|best|perfect)\s+time\s+to\s+(?:invest|buy|sell)|i\s+suggest\s+(?:you\s+)?(?:buy|sell|invest)|must\s+(?:buy|sell|invest)|buy\s+now|sell\s+now|invest\s+kijiye|invest\s+kar\s+(?:do|lo|dijiye)|(?:paisa|paise)\s+lagao|kharid\s+lo|kharido|bech\s+(?:do|dijiye))`, "i"), detail: "gives investment advice" },
  { code: "ADVICE", re: /(निवेश\s*(?:कीजिए|कीजिये|करें|करो)|पैसा\s*लगा(?:इए|ओ|एं|यें)|खरीद\s*(?:लीजिए|लीजिये|लो|लें)|बेच\s*(?:दीजिए|दीजिये|दो|दें))/, detail: "gives investment advice (Hindi)" },
  { code: "PERFORMANCE_CLAIM", re: /\b\d{1,3}(?:\.\d+)?\s?%\s*(?:returns?|p\.?a\.?|annual(?:ly)?|cagr|xirr|irr)\b|\breturns?\s+of\s+(?:about\s+|around\s+|over\s+)?\d{1,3}(?:\.\d+)?\s?%|\btop[\s-]performing\b/i, detail: "quotes performance" },
  // ---- Task 12a: promise / advice / performance PHRASES (appended; earlier rules untouched) ----
  { code: "RETURN_PROMISE", re: new RegExp(String.raw`\b(?:(?:returns?|profits?|gains?)\s+(?:are|is)\s+(?:assured|certain|sure)|you(?:${AP}ll|\s+will)\s+(?:definitely\s+|surely\s+|certainly\s+)?(?:make|earn|get)\s+(?:(?:good|great|big|high|solid|handsome)\s+)?(?:money|profits?|returns?|gains?)|we\s+promise\b|promised\s+returns?|absolutely\s+(?:safe|secure)|your\s+(?:money|investment|capital)\s+will\s+(?:grow|double|multiply|increase))`, "i"), detail: "promises returns or safety" },
  { code: "RETURN_PROMISE", re: /(?:पैसा|पैसे)\s*सुरक्षित\s*रह(?:ेगा|ेंगे)/, detail: "promises safety (Hindi)" },
  { code: "ADVICE", re: new RegExp(String.raw`\b(?:invest\s+kar(?:ein|iye|iyega)|(?:paisa|paise)\s+lag(?:a|aa)\w*|buy\s+(?:this|that|these|our)\s+(?:fund|scheme|pms|stock|plan|aif)s?|(?:i|we)\s+advise\s+you\s+to|consider\s+(?:putting|investing|placing)\s+(?:your\s+)?(?:money|funds?|savings)|(?:aapke|aapko|tumhare|tere)\s+liye\s+(?:best|perfect|ideal))`, "i"), detail: "gives investment advice" },
  { code: "ADVICE", re: /निवेश\s*करना\s*चाहि(?:ए|ये)/, detail: "gives investment advice (Hindi)" },
  { code: "PERFORMANCE_CLAIM", re: /\b(?:delivered|gave|generated|returned|earned|yielded)\s+(?:you\s+)?\d{1,3}(?:\.\d+)?\s?%|\b\d{1,3}(?:\.\d+)?\s?%\s*annuali[sz]ed\b|\bbest\s+(?:pms|fund|scheme|aif|investment)s?\s+in\s+(?:india|the\s+market)\b|\boutperform\w*\s+(?:the\s+)?(?:market|benchmark|index)\b|\bbeat(?:s|ing)?\s+the\s+(?:market|benchmark|index)\b/i, detail: "quotes or claims performance" },
  { code: "RETURN_PROMISE", re: /\b(?:paisa|paise)\s+(?:safe|surakshit)\s+rahega|\b(?:aapka|aapke)\s+(?:paisa|paise)\s+(?:badhega|grow\s+karega)/i, detail: "promises safety or growth (Hinglish)" },
  { code: "RETURN_PROMISE", re: /पैसा\s*(?:बढ़ेगा|दोगुना\s*होगा)/, detail: "promises growth (Hindi)" },
  { code: "ADVICE", re: /\badvise\s+karte\b/i, detail: "gives investment advice (Hinglish)" },
  // ---- Eval-harness findings: phrases the golden cases showed were missing (appended; earlier rules untouched) ----
  { code: "ADVICE", re: /\b(?:our|my)\s+advice\s*(?:is\b|:)/i, detail: "gives investment advice" },
  { code: "RETURN_PROMISE", re: /\b(?:bilkul\s+safe|hamesha\s+(?:profit|munafa|fayda)|(?:paisa|paise)\s+(?:kabhi\s+nahi\s+doob(?:ega|enge)|doob\s+nahi\s+sakta))/i, detail: "promises safety or profit (Hinglish)" },
  { code: "RETURN_PROMISE", re: /(?:नुकसान\s*नहीं|100\s*%\s*सुरक्षित|मुनाफ़?ा\s*ही\s*मुनाफ़?ा)/, detail: "promises safety or profit (Hindi)" },
];

/**
 * Identifiers must never be echoed in a draft (they would sit in the chat history and the vendor log): PAN, Aadhaar
 * (12 digits, grouped or not), Indian mobile numbers and UPI ids. Run on a copy with Devanagari digits mapped to ASCII.
 * Deliberately narrow so ordinary numbers (amounts, PIN codes, toll-free lines, references) pass. Email is not matched:
 * a company address in a draft is legitimate and a customer address is already caught by the vendor scrub.
 */
const UPI_HANDLES = "ok(?:hdfcbank|axis|sbi|icici)|ybl|ibl|axl|paytm|upi|apl|fbl|hdfcbank|axisbank|icici|sbi|pnb|kotak|airtel|jio|freecharge|ikwik|postbank|barodampay|wa(?:axis|hdfcbank|icici|sbi)";
const PII_PATTERNS: RegExp[] = [
  /\b(?:[A-Z]{5}\s?\d{4}\s?[A-Z]|[a-z]{5}\d{4}[a-z])\b/, // PAN, upper case (spaces allowed) or lower case compact
  /(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/, // Aadhaar
  /(?<!\d)(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s.-]?\d{5}(?!\d)/, // Indian mobile
  new RegExp(String.raw`[\w.-]{2,}@(?:${UPI_HANDLES})\b`, "i"), // UPI id
];
const asciiDigits = (s: string) => s.replace(/[०-९]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x966 + 48));

/** NFKC (full-width -> ASCII), strip zero-width/soft-hyphen chars, collapse whitespace. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‏⁠﻿­]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function checkOutbound(text: string): GuardrailResult {
  const t = normalise(text);
  if (!t) return { ok: false, code: "EMPTY", detail: "message is empty" };
  if (t.length > MAX_AGENT_TEXT) return { ok: false, code: "TOO_LONG", detail: `message exceeds ${MAX_AGENT_TEXT} characters` };
  for (const rule of RULES) if (rule.re.test(t)) return { ok: false, code: rule.code, detail: rule.detail };
  const digits = asciiDigits(t);
  if (PII_PATTERNS.some((re) => re.test(digits))) return { ok: false, code: "PII_ECHO", detail: "repeats an identifier (PAN, Aadhaar, mobile number or UPI id)" };
  return { ok: true };
}

/**
 * Trigger stems match with a \w* tail so plurals/inflections ("complaints", "scammed",
 * "refunds") escalate. "withdraw" is deliberately narrow: only withdrawing money/funds or
 * the noun "withdrawal" escalates; "I will withdraw the form" does not.
 */
const HANDOVER = new RegExp(
  [
    String.raw`\b(?:complain\w*|sebi|fraud\w*|scam\w*|cheat\w*|refund\w*|legal\w*|lawyer\w*|police|ombudsman|grievance\w*|fake|withdrawal|shikayat|dhokha|dhoka)\b`,
    String.raw`\bwithdraw\s+(?:all\s+)?(?:of\s+)?(?:my\s+|the\s+)?(?:money|funds?|amount|investments?|capital|savings)\b`,
    String.raw`\b(?:paisa|paise)\s+wapas\b`,
    String.raw`\bconsumer\s+(?:court|forum)\b`,
    String.raw`\b(?:cyber\s*crime|regulator|escalat\w*|thag\w*|money\s+back)\b`,
    String.raw`\b(?:file|lodge|register)\s+(?:an?\s+)?fir\b|\bfir\s+(?:karunga|karungi|karenge|karoonga|darj|against)\b`,
    String.raw`\b(?:paisa|paise)\s+nikal\w*`,
    "शिकायत|धोखा|ठगी|पुलिस|वकील|रिफंड|पैसा\\s+वापस|पैसे\\s+वापस|एफआईआर|उपभोक्ता\\s+(?:अदालत|फोरम)|पैसा\\s+निकाल|पैसे\\s+निकाल",
  ].join("|"),
  "i",
);

/** Customer replies that must go straight to a human RM. */
export function needsHandover(inbound: string): { handover: boolean; reason?: string } {
  const m = HANDOVER.exec(inbound);
  return m ? { handover: true, reason: `customer mentioned "${m[0]}"` } : { handover: false };
}
