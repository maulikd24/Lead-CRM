import { randomInt } from "node:crypto";

/**
 * Referral codes: 8 characters from a 30-symbol alphabet with no look-alikes (no 0, O, 1, I, L, U), about 6.5e11
 * possibilities, drawn from the OS random source. They are not derived from anything about the person, so they cannot
 * be guessed from a name or phone number, and a leaked one is revoked (see the code table), never reused.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 8;

export function generateCode(rng: (maxExclusive: number) => number = (n) => randomInt(n)): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[rng(CODE_ALPHABET.length)];
  return out;
}

/** Any case, dashes and spaces are accepted; anything else (wrong length, look-alike characters) is not a code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export const formatCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

/** The share link: a configured https page plus ?ref=CODE. No configured base means no link (never a made-up host). */
export function shareLink(base: string | undefined, code: string): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:") return null;
    url.searchParams.set("ref", code);
    return url.toString();
  } catch {
    return null;
  }
}
