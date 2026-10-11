import { emailKey, phoneKey } from "@/lib/clients/identity-keys";
import { vendorMatchHash } from "@/lib/privacy/pseudonym";

/**
 * Identity matching data for ad platforms. Pure. Raw phone, email and names never leave this file: callers get SHA-256
 * hex digests (and pseudonymous click ids) only.
 *
 * Normalisation rules per platform (the part that decides whether a hash matches). Both start from the CRM's own
 * identity keys (`emailKey`, `phoneKey`), so a customer is recognised the same way everywhere:
 *
 * Meta Conversions API (user_data.em, user_data.ph)
 *   email   trim, lowercase, then SHA-256 (hex, lowercase).
 *   phone   digits only, country code included, no leading zeros, no symbols: an Indian number is "91" + ten digits
 *           (919876543210), then SHA-256. Meta also accepts fbc and fbp as they are (not hashed).
 * Google Ads (enhanced conversions / offline click conversions, userIdentifiers.hashedEmail / hashedPhoneNumber)
 *   email   trim, lowercase, remove all whitespace; for gmail.com and googlemail.com also remove the dots in the part
 *           before the @; then SHA-256 (hex, lowercase).
 *   phone   E.164 including the leading plus (+919876543210), then SHA-256.
 *           gclid is sent as it is (not hashed).
 * Check both against the platform's current documentation before the first live send: the platforms change these rules.
 */
export type Platform = "meta" | "google";

export type MatchData = {
  hashedEmail?: string;
  hashedPhone?: string;
  fbc?: string;
  fbp?: string;
  gclid?: string;
};

/** The one vendor hash (purpose-bound, in the shared privacy module). Kept under its old name for this module's callers. */
export const sha256Hex = vendorMatchHash;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(raw: string | null | undefined): string | null {
  const key = emailKey(raw);
  if (!key) return null;
  const compact = key.replace(/\s+/g, "");
  return EMAIL_SHAPE.test(key) ? compact : null;
}

/** Digits with country code (no plus, no leading zeros), or null when the number cannot match anyone. */
function internationalDigits(raw: string | null | undefined): string | null {
  const key = phoneKey(raw);
  if (!key) return null;
  const digits = key.length === 10 ? `91${key}` : key;
  return digits.replace(/^0+/, "") || null;
}

export const metaEmail = (raw: string | null | undefined): string | null => cleanEmail(raw);
export const metaPhone = (raw: string | null | undefined): string | null => internationalDigits(raw);

export function googleEmail(raw: string | null | undefined): string | null {
  const email = cleanEmail(raw);
  if (!email) return null;
  const at = email.lastIndexOf("@");
  const domain = email.slice(at + 1);
  return domain === "gmail.com" || domain === "googlemail.com" ? `${email.slice(0, at).replace(/\./g, "")}@${domain}` : email;
}

export function googlePhone(raw: string | null | undefined): string | null {
  const digits = internationalDigits(raw);
  return digits ? `+${digits}` : null;
}

const TOKEN = /^[A-Za-z0-9._\-]{1,200}$/;
const token = (v: unknown): string | undefined => (typeof v === "string" && TOKEN.test(v.trim()) ? v.trim() : undefined);

export type MatchSource = { email: string | null; mobile: string | null; attribution: Record<string, unknown> | null };

/**
 * The identifiers prepared for one platform from what the CRM already holds. `fbc` comes from a stored cookie value when
 * there is one; otherwise it is rebuilt from the fbclid in Meta's documented shape (fb.1.<click time ms>.<fbclid>), using
 * `clickTime` (the lead's creation time: an approximation, documented). Empty object when nothing usable exists.
 */
export function buildMatchData(platform: Platform, source: MatchSource, clickTime: Date): MatchData {
  const out: MatchData = {};
  const email = platform === "meta" ? metaEmail(source.email) : googleEmail(source.email);
  const phone = platform === "meta" ? metaPhone(source.mobile) : googlePhone(source.mobile);
  if (email) out.hashedEmail = sha256Hex(email);
  if (phone) out.hashedPhone = sha256Hex(phone);
  const a = source.attribution ?? {};
  if (platform === "meta") {
    const fbp = token(a.fbp);
    const fbc = token(a.fbc) ?? (token(a.fbclid) ? `fb.1.${clickTime.getTime()}.${token(a.fbclid)}` : undefined);
    if (fbp) out.fbp = fbp;
    if (fbc) out.fbc = fbc;
  } else {
    const gclid = token(a.gclid);
    if (gclid) out.gclid = gclid;
  }
  return out;
}
