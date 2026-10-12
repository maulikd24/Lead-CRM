/**
 * One phone/email identity rule for every lead source. Contacts arrive in every shape (+91 98765-43210,
 * 09876543210, 919876543210, 0091…) and Client.mobile/email are stored exactly as received, so matching compares
 * these keys — kept in Client/AccountHolder.mobileKey/emailKey by the query extension in src/lib/db/prisma.ts and
 * backfilled by migration 20261023000000_client_identity_keys, whose SQL mirrors phoneKey() exactly.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2); // international dialling prefix
  if (digits.length === 13 && digits.startsWith("910")) return digits.slice(3); // +91 0XXXXXXXXXX
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2); // +91XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1); // 0XXXXXXXXXX
  if (digits.length >= 8) return digits; // a 10-digit Indian number, or an international number as-is
  return null;
}

export function emailKey(raw: string | null | undefined): string | null {
  const key = raw?.trim().toLowerCase();
  return key ? key : null;
}
