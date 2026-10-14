import { emailKey, phoneKey } from "@/lib/clients/identity-keys";

/**
 * Search must not be a way round the mask. A substring match on mobile or email lets anyone type "98", "987", ... and watch which masked
 * rows stay, recovering the whole value with no audit. So only an Admin (who can reveal anyway) gets substring matching on these fields;
 * everyone else matches a complete number or complete email, exactly, on the normalised key. Name and client code stay substring.
 * Works for Client and AccountHolder rows (both carry mobile, email, mobileKey, emailKey).
 */
export function contactSearchClauses(q: string, isAdmin: boolean) {
  if (isAdmin) return [{ mobile: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }];
  const out: Array<{ mobileKey: string } | { emailKey: string }> = [];
  const digits = q.replace(/\D/g, "");
  const mobile = digits.length >= 10 ? phoneKey(q) : null;
  if (mobile) out.push({ mobileKey: mobile });
  const trimmed = q.trim();
  const at = trimmed.indexOf("@");
  if (at > 0 && trimmed.indexOf(".", at) > at + 1 && trimmed.length >= 6 && !trimmed.endsWith(".")) {
    const key = emailKey(trimmed);
    if (key) out.push({ emailKey: key });
  }
  return out;
}

/** Mobile only (the places that never searched email: Cmd+K, household picker). */
export function mobileSearchClauses(q: string, isAdmin: boolean) {
  return contactSearchClauses(q, isAdmin).filter((c) => "mobile" in c || "mobileKey" in c);
}
