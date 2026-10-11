/**
 * PII masking for voice-of-customer text. A pure function, run BEFORE any text reaches the AI gateway. Each rule masks one kind of
 * identifier with a fixed token, so the model sees that something was there without seeing it.
 *
 * Order matters: email, then PAN, then phone (a +91 mobile number is 12 digits, so it must be taken before the Aadhaar rule),
 * then Aadhaar, then the generic account-number run last.
 *
 * Rules (token in brackets):
 *   email    name@host.tld                                   [email]
 *   pan      [A-Z]{5}[0-9]{4}[A-Z] as a whole word          [pan]
 *   aadhaar  12 digits, optionally grouped 4-4-4 by space or hyphen   [aadhaar]
 *   phone    10 digits starting 6-9, optional +91 / 91 prefix, optional 5-5 grouping   [phone]
 *   account  any other run of 9 to 18 digits (account and card-like numbers)           [account]
 *
 * The output carries no count-free copy of the input: the counts say how many of each were masked, never what they were.
 */

export const VOC_REDACTION_KINDS = ["email", "pan", "aadhaar", "phone", "account"] as const;
export type VocRedactionKind = (typeof VOC_REDACTION_KINDS)[number];
export type VocRedactionCounts = Record<VocRedactionKind, number>;

const RULES: ReadonlyArray<{ kind: VocRedactionKind; token: string; pattern: RegExp }> = [
  { kind: "email", token: "[email]", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "pan", token: "[pan]", pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  { kind: "phone", token: "[phone]", pattern: /(?<![0-9])(?:\+?91[ -]?)?[6-9][0-9]{4}[ -]?[0-9]{5}(?![0-9])/g },
  { kind: "aadhaar", token: "[aadhaar]", pattern: /\b[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}\b/g },
  { kind: "account", token: "[account]", pattern: /(?<![0-9])[0-9]{9,18}(?![0-9])/g },
];

export function emptyCounts(): VocRedactionCounts {
  return { email: 0, pan: 0, aadhaar: 0, phone: 0, account: 0 };
}

/** Masks every identifier in `input`. Returns the masked text and how many of each kind were masked. */
export function redactFeedback(input: string): { text: string; counts: VocRedactionCounts } {
  const counts = emptyCounts();
  let text = input;
  for (const rule of RULES) {
    text = text.replace(rule.pattern, () => {
      counts[rule.kind] += 1;
      return rule.token;
    });
  }
  return { text, counts };
}

/** True when a masked-looking string still holds a rule's shape. Used as a final assertion, never as the redactor itself. */
export function hasIdentifier(text: string): boolean {
  return RULES.some((rule) => new RegExp(rule.pattern.source).test(text));
}
