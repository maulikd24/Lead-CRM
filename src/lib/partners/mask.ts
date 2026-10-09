/**
 * Field hiding for the Partner workspace. PAN and bank details are never declared in the response
 * schemas, so they cannot reach a page at all. Mobile numbers are the only personal contact detail
 * shown, and only their last four digits, in the same "dots + tail" style as the rest of the CRM.
 */
export function maskMobile(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  // Short numbers are easier to guess from a tail, so they reveal less of it.
  return `••••••${digits.slice(digits.length < 10 ? -2 : -4)}`;
}
