import { createHash } from "node:crypto";

/**
 * The disclosure wording that ends every invitation. It is configurable (Programme settings), has a safe built-in default
 * (no amounts, no promise, market-risk reminder) and can only be USED after a compliance sign-off is recorded for the exact
 * wording in force: change one character and the sign-off no longer matches. The person who last edited custom wording
 * cannot be the one who records its sign-off. The sign-off is an attestation recorded in the CRM; it does not replace
 * the firm's own compliance approval process.
 */
export const DEFAULT_DISCLAIMER = "Referral rewards, if any, follow the programme terms and may change. Investments are subject to market risks. Please read the offer documents carefully before investing.";

export type Wording = { text: string; source: "custom" | "default" };

export function effectiveDisclaimer(custom: string | null | undefined): Wording {
  const t = custom?.trim();
  return t ? { text: t, source: "custom" } : { text: DEFAULT_DISCLAIMER, source: "default" };
}

/** SHA-256 of the trimmed wording: the sign-off binds to exactly this text. */
export const wordingHash = (text: string): string => createHash("sha256").update(text.trim(), "utf8").digest("hex");

export type Signoff = { by: string; approver: string; at: string; hash: string };

export function parseSignoff(raw: string | null | undefined): Signoff | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v && typeof v === "object" && !Array.isArray(v) && typeof v.by === "string" && v.by && typeof v.approver === "string" && v.approver.trim() && typeof v.at === "string" && typeof v.hash === "string" && v.hash) return { by: v.by, approver: v.approver, at: v.at, hash: v.hash };
  } catch {
    /* a broken record is the same as no record */
  }
  return null;
}

export type SignoffState = Wording & { signedOff: boolean; approver?: string; at?: string; selfApproved?: boolean };

export function signoffState(i: { custom: string | null | undefined; signoff: string | null | undefined; editor?: string | null }): SignoffState {
  const wording = effectiveDisclaimer(i.custom);
  const rec = parseSignoff(i.signoff);
  if (!rec || rec.hash !== wordingHash(wording.text)) return { ...wording, signedOff: false };
  if (wording.source === "custom" && i.editor && rec.by === i.editor) return { ...wording, signedOff: false, selfApproved: true };
  return { ...wording, signedOff: true, approver: rec.approver, at: rec.at };
}
