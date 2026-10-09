import { normalizeEmail, normalizePan, normalizePhone } from "@/lib/utils/normalize-contact";

export type Identity = { id: string; name: string; mobile: string | null; email: string | null; pan: string | null };

/** Suggestions are only persisted at or above this score. */
export const SUGGESTION_THRESHOLD = 0.8;

const tokens = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

/** Two name tokens match when equal, or when one is a single-letter initial of the other ("R" ~ "Riya"). */
function tokenMatch(x: string, y: string): boolean {
  if (x === y) return true;
  if (x.length === 1) return y.startsWith(x);
  if (y.length === 1) return x.startsWith(y);
  return false;
}

/** Order-insensitive overlap in [0,1]; 0 when either side has no tokens. */
function nameSimilarity(a: string, b: string): number {
  const ta = [...new Set(tokens(a))];
  const tb = [...new Set(tokens(b))];
  if (ta.length === 0 || tb.length === 0) return 0;
  // A lone token ("Sharma") must not match every full name containing it: only an identical lone token counts.
  if (ta.length === 1 || tb.length === 1) return ta.length === tb.length && ta[0] === tb[0] ? 1 : 0;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const shared = small.filter((t) => large.some((u) => tokenMatch(t, u))).length;
  return shared / small.length;
}

/**
 * Comparable phone digits, or null when unusable: blank, under 10 digits (landline fragments),
 * or a placeholder of one repeated digit (0000000000, 9999999999). A single leading 0 is trunk prefix, stripped.
 */
export function comparablePhone(raw: string | null): string | null {
  if (!raw) return null;
  let p = normalizePhone(raw);
  if (p.length === 11 && p.startsWith("0")) p = p.slice(1);
  if (p.length < 10 || /^(\d)\1+$/.test(p)) return null;
  return p;
}

export function comparableEmail(raw: string | null): string | null {
  if (!raw) return null;
  const e = normalizeEmail(raw);
  return e.includes("@") ? e : null;
}

/**
 * Score how likely two customers are the same person. Suggest-only: the caller never merges.
 * - Same PAN: near-certain. Different PANs: different legal persons, score 0 regardless of mobile/email.
 * - Same mobile alone (0.6) is NOT enough: families share phones. A similar name is also required to reach 0.8.
 */
export function scoreDuplicate(a: Identity, b: Identity): { score: number; reasons: string[] } {
  const panA = a.pan ? normalizePan(a.pan) : "";
  const panB = b.pan ? normalizePan(b.pan) : "";
  if (panA && panB) {
    return panA === panB ? { score: 0.98, reasons: ["same PAN"] } : { score: 0, reasons: ["different PAN"] };
  }
  const reasons: string[] = [];
  let score = 0;
  const pa = comparablePhone(a.mobile);
  const ea = comparableEmail(a.email);
  if (pa && pa === comparablePhone(b.mobile)) { score += 0.6; reasons.push("same mobile"); }
  if (ea && ea === comparableEmail(b.email)) { score += 0.3; reasons.push("same email"); }
  const names = nameSimilarity(a.name, b.name);
  if (names >= 0.5) { score += 0.25 * names; reasons.push("similar name"); }
  return { score: Math.min(score, 0.97), reasons };
}
