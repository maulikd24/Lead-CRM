/** Strips formatting for comparison only — stored values are never rewritten. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 10 && digits.startsWith("91") ? digits.slice(-10) : digits;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
