/**
 * The one mask for a customer's contact details, applied on the server before anything reaches the browser.
 *  - mobile: last 3 digits only (`+91 ••••• ••123`)
 *  - email: first character plus the domain (`a•••@gmail.com`)
 *  - CKYC reference: last 3 characters only
 * The same output is used everywhere a contact is shown (client page, lists, Cmd+K, inbox, dealer desk), so one rule changes in one place.
 */
export const MASKED_FIELDS = ["mobile", "email", "ckycRef"] as const;
export type MaskedField = (typeof MASKED_FIELDS)[number];

export function maskMobile(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "•••••";
  const tail = digits.slice(-3);
  const indian = digits.length === 10 || (digits.length === 12 && digits.startsWith("91"));
  return indian ? `+91 ••••• ••${tail}` : `•••••• ••${tail}`;
}

export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return "••••";
  return `${value[0]}•••${value.slice(at)}`;
}

export function maskCkycRef(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (v.length <= 3) return "•••";
  return `•••••••${v.slice(-3)}`;
}

export const MASKERS: Record<MaskedField, (v: string | null | undefined) => string | null> = {
  mobile: maskMobile,
  email: maskEmail,
  ckycRef: maskCkycRef,
};

/**
 * Returns a copy of `row` where mobile / email / ckycRef (whichever are present) are replaced by their masked form.
 * Use this on any object about to cross into a client component, a list payload or a returned action result.
 */
export function maskContactFields<T extends { mobile?: string | null; email?: string | null; ckycRef?: string | null }>(row: T): T {
  const out = { ...row };
  if ("mobile" in out) out.mobile = maskMobile(out.mobile) as T["mobile"];
  if ("email" in out) out.email = maskEmail(out.email) as T["email"];
  if ("ckycRef" in out) out.ckycRef = maskCkycRef(out.ckycRef) as T["ckycRef"];
  return out;
}

/** Columns that hold the raw contact in another shape (normalised keys, the Freshdesk sync identity). Never sent to the browser. */
const IDENTITY_KEY_COLUMNS = ["mobileKey", "emailKey", "freshdeskSyncKey"] as const;

/**
 * A customer or holder row made safe for the browser: contact fields masked, and the columns that carry the same value in
 * normalised form blanked (mobileKey is the mobile's digits, emailKey the lower-cased email). The row keeps its type.
 */
export function toBrowserContact<T extends { mobile?: string | null; email?: string | null; ckycRef?: string | null }>(row: T): T {
  const out = maskContactFields(row) as Record<string, unknown>;
  for (const key of IDENTITY_KEY_COLUMNS) if (key in out) out[key] = null;
  return out as T;
}

/** Audit rows keep the raw old and new values on record; what is shown has the three contact keys masked. */
export function maskContactInJson(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of MASKED_FIELDS) if (typeof out[key] === "string") out[key] = MASKERS[key](out[key] as string);
  return out;
}
