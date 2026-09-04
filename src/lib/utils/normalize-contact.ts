/** Strips formatting for comparison only — stored values are never rewritten. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length > 10 && digits.startsWith("91") ? digits.slice(-10) : digits;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Unlike phone/email, PAN has one canonical government format — store it normalized, not just compare normalized. */
export function normalizePan(raw: string): string {
  return raw.trim().toUpperCase();
}
