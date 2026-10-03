// Free text (notes, task titles, activity messages) can contain a client's phone, email or PAN typed in by a
// user. Those must never reach a third-party AI provider, so every free-text fact goes through here first.

export function redactPii(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, "[PAN]")
    .replace(/(\+?\d[\d\s-]{7,}\d)/g, "[number]");
}

/** Redacts, collapses whitespace and caps length — for one-line facts. */
export function safeLine(text: string | null | undefined, max = 140): string {
  if (!text) return "";
  const cleaned = redactPii(text).replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}
