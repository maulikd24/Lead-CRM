import { createHash, randomBytes } from "node:crypto";

/**
 * Shareable report links. The token is 32 random bytes (256 bits), url-safe, shown once when the link is made. Only its
 * SHA-256 is stored, so a database read cannot recreate a link. A link expires (1 to 30 days, default 7) and can be
 * revoked at any time. The page behind it reads a stored snapshot of aggregate numbers, never live customer tables.
 */

export const DEFAULT_EXPIRY_DAYS = 7;
export const MAX_EXPIRY_DAYS = 30;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const generateToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
export const isWellFormedToken = (token: unknown): token is string => typeof token === "string" && TOKEN_RE.test(token);

export function clampExpiryDays(days: number | undefined): number {
  if (days === undefined || !Number.isFinite(days)) return DEFAULT_EXPIRY_DAYS;
  return Math.min(MAX_EXPIRY_DAYS, Math.max(1, Math.round(days)));
}

export type ShareState = "open" | "expired" | "revoked" | "pending";
/** revoked (withdrawn, or declined before it ever opened) wins; then expired; then pending (awaiting a person's approval); then open. */
export function shareState(row: { expiresAt: Date; revokedAt: Date | null; awaitingApproval?: boolean }, now: Date): ShareState {
  if (row.revokedAt) return "revoked";
  if (now.getTime() >= row.expiresAt.getTime()) return "expired";
  return row.awaitingApproval ? "pending" : "open";
}

export type ShareDecisionPlan = { ok: true; decision: "approve" } | { ok: true; decision: "decline"; reason: string } | { ok: false; error: string };

/**
 * The rule for deciding on the publication of a report link (the legacy path the canonical director-report approval calls). Pure: the caller does the
 * compare-and-set write. Four eyes (the approval setting) keep the person who made the link from approving it; declining is open to anyone who may
 * decide. Only a link that still awaits approval, has not expired and has not been revoked can be decided.
 */
export function planShareDecision(input: { share: { awaitingApproval: boolean; revokedAt: Date | null; expiresAt: Date; createdById: string }; actorId: string; decision: "approve" | "decline"; fourEyes: boolean; confirmed?: boolean; reason?: string; now: Date }): ShareDecisionPlan {
  const { share } = input;
  if (shareState(share, input.now) !== "pending") return { ok: false, error: "That link is no longer waiting for approval." };
  if (input.decision === "decline") {
    const reason = (input.reason ?? "").trim();
    return reason ? { ok: true, decision: "decline", reason: reason.slice(0, 300) } : { ok: false, error: "Say why the link is being declined." };
  }
  if (input.fourEyes && share.createdById === input.actorId) return { ok: false, error: "A second person has to approve this link: the person who made it cannot." };
  if (!input.confirmed) return { ok: false, error: "Tick the box to confirm you have read the report." };
  return { ok: true, decision: "approve" };
}

const FORBIDDEN_KEYS = new Set(["clientid", "client_id", "email", "phone", "mobile", "pan", "aadhaar", "name_of_client", "customername", "customer_name", "address", "dob"]);
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

/**
 * A last line of defence: the report is aggregates by construction, but a campaign name typed by a person could hold a
 * contact detail. Personal identifiers found in any text are replaced, and any key that names personal data is dropped.
 */
export function scrubSnapshot<T>(input: T): { value: T; removed: number } {
  let removed = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const out = v.replace(EMAIL, () => (removed++, "[removed]")).replace(PAN, () => (removed++, "[removed]")).replace(PHONE, () => (removed++, "[removed]"));
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (FORBIDDEN_KEYS.has(k.toLowerCase())) { removed++; continue; }
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return { value: walk(input) as T, removed };
}
