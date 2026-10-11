/**
 * Pure decision logic for "Continue with Google" (company Google sign-in).
 * Nothing here touches the network, the database or process.env directly, so every rule is unit-testable with a
 * fake profile. The rules, in order:
 *   1. The allow-list of company email domains is empty by default: empty means Google sign-in is disabled.
 *   2. The email must be present, well-formed ASCII and verified by Google.
 *   3. Its domain must be on the allow-list (exact match, no sub-domains).
 *   4. Google's hosted-domain claim (`hd`) must equal that domain, so a personal Google account that merely
 *      carries a company address is refused.
 *   5. A user with that email must ALREADY exist and be active. Nothing is ever created here, and the role
 *      always comes from the database, never from Google.
 * Every refusal reaches the person as the same calm "ask an admin for access" state (GOOGLE_PUBLIC_OUTCOME): the
 * reason is for the audit trail only, so the screen cannot be used to find out who has an account.
 */
import { isAsciiEmail, matchSsoUser, normalizeEmail, type SsoUserRecord } from "@/lib/auth/sso";

type Env = Record<string, string | undefined>;

export type GoogleConfig = { enabled: false } | { enabled: true; clientId: string; clientSecret: string };

/** On only for the exact value "1" with both credentials present. The admin enters the values; nothing is invented here. */
export function googleSignInConfigFromEnv(env: Env): GoogleConfig {
  if (env.GOOGLE_SIGNIN_ENABLED !== "1") return { enabled: false };
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { enabled: false };
  return { enabled: true, clientId, clientSecret };
}

const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Accepts a list or a comma/space/newline separated string; keeps only plain lower-case domains, de-duplicated. */
export function parseAllowedDomains(raw: unknown): string[] {
  const items: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/) : [];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const d = item.trim().toLowerCase();
    if (DOMAIN.test(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

export const GOOGLE_PUBLIC_OUTCOME = "AccessDenied" as const;

export type GoogleProfile = { email?: unknown; email_verified?: unknown; hd?: unknown; [k: string]: unknown };
export type GoogleUserRecord = SsoUserRecord;
export type GoogleFailure =
  | "no_domains_configured"
  | "invalid_profile"
  | "email_unverified"
  | "domain_not_allowed"
  | "hosted_domain_mismatch"
  | "unknown_user"
  | "inactive_user"
  | "ambiguous_user";
export type GoogleDeps = { findUsersByEmail: (normalizedEmail: string) => Promise<GoogleUserRecord[]> };

export async function decideGoogleSignIn(
  profile: GoogleProfile | null | undefined,
  allowedDomains: readonly string[],
  deps: GoogleDeps,
): Promise<{ ok: true; user: GoogleUserRecord } | { ok: false; reason: GoogleFailure; email?: string }> {
  if (allowedDomains.length === 0) return { ok: false, reason: "no_domains_configured" };
  if (!profile || typeof profile.email !== "string") return { ok: false, reason: "invalid_profile" };
  const raw = profile.email.trim();
  if (raw.length > 254 || !isAsciiEmail(raw)) return { ok: false, reason: "invalid_profile" };
  const email = normalizeEmail(raw);
  if (profile.email_verified !== true) return { ok: false, reason: "email_unverified", email };
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!allowedDomains.some((d) => d.toLowerCase() === domain)) return { ok: false, reason: "domain_not_allowed", email };
  if (typeof profile.hd !== "string" || profile.hd.trim().toLowerCase() !== domain) return { ok: false, reason: "hosted_domain_mismatch", email };
  const match = await matchSsoUser(profile, deps);
  if (!match.ok) {
    const reason = match.reason === "unknown_user" || match.reason === "inactive_user" || match.reason === "ambiguous_user" ? match.reason : "invalid_profile";
    return { ok: false, reason, email };
  }
  return { ok: true, user: match.user };
}
