/**
 * Referral attribution by code: a partner's link or code carries their partner code into a lead form or the app signup,
 * and the first touch wins. Pure decision logic; the database part is in record.ts.
 */
const CODE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A partner code as typed, or null. Only letters, digits and hyphens, 3 to 40 characters: nothing else is ever looked up or stored. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 60) return null;
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

export type TouchDecision =
  | { decision: "recorded"; expiresAt: Date }
  | { decision: "replaced_lapsed"; expiresAt: Date }
  | { decision: "kept_first_same"; expiresAt: Date }
  | { decision: "kept_first_other"; expiresAt: Date }
  | { decision: "ignored_unknown" }
  | { decision: "ignored_inactive" };

/**
 * What to do with a code that resolved to a partner (or to nothing). No earlier touch: record it. An earlier touch that
 * has not lapsed: keep it (first touch wins), and note whether the new one was the same partner (a retry, silent) or a
 * different one. A lapsed earlier touch is replaced and the window starts again. Unknown and inactive partners are ignored.
 */
export function decideTouch(input: {
  existing: { partnerProfileId: string; expiresAt: Date } | null;
  partner: { partnerProfileId: string; status: string } | null;
  now: Date;
  lapseDays: number;
}): TouchDecision {
  if (!Number.isInteger(input.lapseDays) || input.lapseDays < 1) throw new Error("The lapse window must be a whole number of days");
  if (!input.partner) return { decision: "ignored_unknown" };
  if (input.partner.status !== "ACTIVE") return { decision: "ignored_inactive" };
  const expiresAt = new Date(input.now.getTime() + input.lapseDays * DAY_MS);
  if (!input.existing) return { decision: "recorded", expiresAt };
  if (input.existing.expiresAt.getTime() <= input.now.getTime()) return { decision: "replaced_lapsed", expiresAt };
  return { decision: input.existing.partnerProfileId === input.partner.partnerProfileId ? "kept_first_same" : "kept_first_other", expiresAt: input.existing.expiresAt };
}
