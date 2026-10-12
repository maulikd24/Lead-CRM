/**
 * Pure, conservative matcher for "stop contacting me" replies on an inbound message.
 *
 * It matches only when the WHOLE message is one of a short list of opt-out phrases (after lower-casing and
 * stripping punctuation, emoji and a polite filler such as "please"). Anything longer or more specific
 * ("stop my SIP", "stop loss order", "do not stop") is left to a human. A false negative costs an RM a read;
 * a false positive would silence a customer who did not ask for it.
 *
 * The matcher only answers yes or no. It never decides what to do about it: see inbound.ts.
 */

const FILLERS = new Set(["please", "pls", "plz", "kindly", "ji", "kripya", "कृपया"]);

const PHRASES = new Set<string>([
  // English
  "stop", "stop all", "stop all messages", "stop messages", "stop messaging", "stop messaging me", "stop sending",
  "stop sending messages", "stop sending me messages", "stop texting me", "unsubscribe", "unsubscribe me", "unsubscribe all",
  "opt out", "optout", "opt me out", "do not contact me", "dont contact me", "do not message me", "dont message me",
  "dont text me", "remove me", "remove me from the list", "remove my number",
  // Hinglish (Latin script)
  "band karo", "band kro", "bandh karo", "bandh kro", "band kijiye", "message band karo", "msg band karo", "messages band karo",
  "sandesh band karo", "mat bhejo", "mat bhejiye", "mat bhejna", "msg mat bhejo", "message mat bhejo", "mujhe message mat bhejo",
  "mujhe msg mat bhejo",
  // Hindi (Devanagari)
  "रोकें", "रोको", "रोक दो", "रोक दें", "बंद करो", "बंद करें", "बंद कीजिए", "बन्द करो", "बन्द करें", "मैसेज बंद करो",
  "मैसेज बंद करें", "संदेश बंद करो", "संदेश बंद करें", "सदस्यता रद्द करें", "सदस्यता रद्द करो", "मैसेज मत भेजो", "मैसेज न भेजें",
]);

/** Lower-case, NFKC, drop apostrophes, turn every other non-letter/mark/digit into a space, collapse, drop fillers at the ends. */
export function normalizeForKeyword(text: string): string {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && FILLERS.has(words[0])) words.shift();
  while (words.length > 1 && FILLERS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** True when the whole message is an opt-out phrase. */
export function matchStopKeyword(text: string): boolean {
  if (typeof text !== "string" || text.length > 200) return false;
  const n = normalizeForKeyword(text);
  return n.length > 0 && PHRASES.has(n);
}
