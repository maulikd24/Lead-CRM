import { ASSET_CLASSES } from "@/lib/intelligence/constants";

/**
 * Words and phrases that name an asset class in free text, per class. A term matches whole words at the start of a word,
 * so "mutual fund options" (term "mutual fund") and "bonds" (term "bond") are caught. Used by every check that keeps a
 * blocked class out of a talking point, a commitment, or an AI reply.
 */
export const CLASS_TERMS: Record<(typeof ASSET_CLASSES)[number], readonly string[]> = {
  "Mutual Funds": ["mutual fund", "mutual funds", "sip", "elss", "index fund", "debt fund", "equity fund"],
  PMS: ["pms", "portfolio management", "portfolio manager"],
  AIF: ["aif", "alternative investment", "alternative fund", "private equity", "venture fund"],
  Bonds: ["bond", "debenture", "g sec", "gsec", "fixed income"],
  Broking: ["broking", "broker", "trading account", "demat", "stock trading"],
  "Global Investments": ["global invest", "international fund", "overseas", "global fund", "lrs", "us stock", "international invest"],
  "Tax Planning": ["tax plan", "tax saving", "tax saver", "80c", "tax planning"],
};

const normalise = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** True when the text names the asset class by any of its terms. */
export function textNamesClass(text: string, assetClass: string): boolean {
  const terms = (CLASS_TERMS as Record<string, readonly string[]>)[assetClass] ?? [];
  const norm = normalise(text);
  return terms.some((term) => norm.includes(` ${normalise(term).trim()}`));
}

/** True when the text names any of the blocked asset classes. */
export function mentionsBlockedClass(text: string, blockedClasses: readonly string[]): boolean {
  return blockedClasses.some((c) => textNamesClass(text, c));
}

/** A do-not-discuss entry that is about one asset class, e.g. "PMS: said not interested on ...". */
export function isClassEntry(entry: string): boolean {
  return (ASSET_CLASSES as readonly string[]).some((c) => entry.startsWith(`${c}:`));
}

const SALES_WORDS = /\b(pitch(es|ing)?|explor(e|es|ing)|offer(s|ed|ing)?|new|product|products|invest(ing|ment|ments)?|opportunit(y|ies)|buy|purchase)\b/i;

/** Sales vocabulary: pitch words, product names (asset classes and their terms) or the words above. */
export function hasSalesVocabulary(text: string): boolean {
  return SALES_WORDS.test(text) || mentionsBlockedClass(text, ASSET_CLASSES);
}
