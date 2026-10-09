/**
 * Pure, dependency-injected building blocks for Keycloak (OpenID Connect) single sign-on.
 * Nothing here touches the network, the database or process.env directly, so every rule is unit-testable.
 * See docs/integrations/keycloak-sso.md for the operator view.
 */

export type SsoConfig =
  | { enabled: false; ssoOnly: false; breakGlass: string[] }
  | { enabled: true; issuer: string; clientId: string; clientSecret: string; baseUrl: string; ssoOnly: boolean; breakGlass: string[] };

type Env = Record<string, string | undefined>;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DISABLED: SsoConfig = { enabled: false, ssoOnly: false, breakGlass: [] };

/** Absolute SSO session lifetime; see ssoSessionExpired. */
export const SSO_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * Emails are matched as plain ASCII only. toLowerCase() folds some non-ASCII characters onto ASCII ones (the Kelvin
 * sign U+212A becomes "k"), so a verified identity-provider address could otherwise take over a different user's account.
 */
const ASCII_PRINTABLE = /^[\x21-\x7e]+$/;
export function isAsciiEmail(email: string): boolean {
  return ASCII_PRINTABLE.test(email) && /^[^@]+@[^@]+$/.test(email);
}

export function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Lowercase + trim. Plus-suffixes are deliberately NOT stripped: "a+x@d" and "a@d" are different mailboxes. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * SSO is on only when SSO_ENABLED is exactly "1" AND issuer/client id/client secret are all present and the
 * issuer is an https URL (http only for loopback, for local testing). Anything else behaves like today.
 * SSO_ONLY is honoured only when SSO itself is enabled, so a half-configured env can never lock everyone out.
 */
export function ssoConfigFromEnv(env: Env): SsoConfig {
  if (env.SSO_ENABLED !== "1") return DISABLED;
  const issuerRaw = env.KEYCLOAK_ISSUER?.trim();
  const clientId = env.KEYCLOAK_CLIENT_ID?.trim();
  const clientSecret = env.KEYCLOAK_CLIENT_SECRET?.trim();
  // The public base URL is required too: provider logout needs it for the post-logout redirect.
  const baseUrl = (env.AUTH_URL?.trim() || env.NEXTAUTH_URL?.trim() || "").replace(/\/$/, "");
  if (!issuerRaw || !clientId || !clientSecret || !baseUrl) return DISABLED;
  let parsed: URL;
  try {
    parsed = new URL(issuerRaw);
  } catch {
    return DISABLED;
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) return DISABLED;
  const okScheme = parsed.protocol === "https:" || (parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname));
  if (!okScheme) return DISABLED;
  const breakGlass = (env.SSO_BREAK_GLASS_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(isAsciiEmail)
    .map(normalizeEmail);
  return {
    enabled: true,
    issuer: stripTrailingSlash(issuerRaw),
    clientId,
    clientSecret,
    baseUrl,
    ssoOnly: env.SSO_ONLY === "1",
    breakGlass,
  };
}

export type SsoProfile = { email?: unknown; email_verified?: unknown; [k: string]: unknown };

/** The email claim must be a present, well-formed string and email_verified must be the boolean true. */
export function isEmailAllowed(
  profile: SsoProfile | null | undefined,
): { ok: true; email: string } | { ok: false; reason: "invalid_profile" | "email_unverified" } {
  if (!profile || typeof profile.email !== "string") return { ok: false, reason: "invalid_profile" };
  const raw = profile.email.trim();
  if (raw.length > 254 || !isAsciiEmail(raw)) return { ok: false, reason: "invalid_profile" };
  const email = normalizeEmail(raw);
  if (profile.email_verified !== true) return { ok: false, reason: "email_unverified" };
  return { ok: true, email };
}

/** Issuer pinning: the token's `iss` must equal the configured issuer exactly (one trailing slash tolerated). */
export function issuerMatches(tokenIssuer: unknown, configured: string): boolean {
  return typeof tokenIssuer === "string" && stripTrailingSlash(tokenIssuer) === stripTrailingSlash(configured);
}

const BASE = "http://relative.invalid";
const NEVER_TARGET = /^\/(login|api\/auth)(\/|\?|#|$)/;

/** Only same-origin absolute paths survive; everything else becomes the fallback. */
export function safeCallbackUrl(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return fallback;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  // eslint-disable-next-line no-control-regex
  if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw) || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;
  let u: URL;
  try {
    u = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (u.origin !== BASE || u.pathname.startsWith("//")) return fallback;
  const out = u.pathname + u.search + u.hash;
  let lowered: string;
  try {
    lowered = decodeURIComponent(out).toLowerCase();
  } catch {
    return fallback;
  }
  return NEVER_TARGET.test(lowered) ? fallback : out;
}

/** NextAuth `redirect` callback: same origin only. The provider logout redirect is issued by our own server action, never here. */
export function safeRedirect(url: string, baseUrl: string): string {
  if (url.startsWith("/")) {
    const safe = safeCallbackUrl(url, "");
    return safe ? baseUrl + safe : baseUrl;
  }
  try {
    return new URL(url).origin === new URL(baseUrl).origin ? url : baseUrl;
  } catch {
    return baseUrl;
  }
}

/** Credentials sign-in is open to all unless SSO_ONLY is set; then only the documented break-glass emails. */
export function credentialsAllowed(email: string, config: SsoConfig): boolean {
  if (!config.enabled || !config.ssoOnly) return true;
  const trimmed = email.trim();
  return isAsciiEmail(trimmed) && config.breakGlass.includes(normalizeEmail(trimmed));
}

export type SsoUserRecord = { id: string; email: string; name: string; role: string; isActive: boolean; lockedUntil: Date | null };
export type SsoMatchFailure = "invalid_profile" | "email_unverified" | "unknown_user" | "inactive_user" | "ambiguous_user";
export type SsoMatchDeps = {
  /** Case-insensitive lookup by an already-normalised email; may return several rows. */
  findUsersByEmail: (normalizedEmail: string) => Promise<SsoUserRecord[]>;
};

/** Match an OIDC profile to an EXISTING Supportify user. Never creates users; the role always comes from the database. */
export async function matchSsoUser(
  profile: SsoProfile | null | undefined,
  deps: SsoMatchDeps,
): Promise<{ ok: true; user: SsoUserRecord } | { ok: false; reason: SsoMatchFailure; email?: string }> {
  const checked = isEmailAllowed(profile);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const rows = await deps.findUsersByEmail(checked.email);
  const hits = rows.filter((u) => isAsciiEmail(u.email) && normalizeEmail(u.email) === checked.email);
  if (hits.length === 0) return { ok: false, reason: "unknown_user", email: checked.email };
  if (hits.length > 1) return { ok: false, reason: "ambiguous_user", email: checked.email };
  const user = hits[0];
  if (!user.isActive) return { ok: false, reason: "inactive_user", email: checked.email };
  // The password lockout (lockedUntil) deliberately does not apply to SSO: otherwise anyone guessing at a user's
  // password could keep that user, or a break-glass admin during an identity-provider outage, out of SSO.
  return { ok: true, user };
}

/**
 * Absolute session lifetime for SSO tokens. @auth/core re-issues the JWT cookie with a fresh expiry on every
 * session read, so the cookie maxAge slides; this check is what makes the 8 hours a hard limit.
 */
export function ssoSessionExpired(token: { sso?: boolean; authTime?: number }, nowMs: number, config: SsoConfig): boolean {
  if (!config.enabled || !token.sso) return false;
  return nowMs - (token.authTime ?? 0) > SSO_SESSION_MAX_AGE_SECONDS * 1000;
}

/** Keycloak RP-initiated logout endpoint for the configured realm, or null when SSO is off. */
export function endSessionEndpoint(config: SsoConfig): string | null {
  return config.enabled ? `${config.issuer}/protocol/openid-connect/logout` : null;
}

export function buildEndSessionUrl(config: SsoConfig, opts: { idTokenHint?: string; postLogoutRedirectUri: string }): string | null {
  if (!config.enabled) return null;
  const u = new URL(endSessionEndpoint(config)!);
  if (opts.idTokenHint) u.searchParams.set("id_token_hint", opts.idTokenHint);
  else u.searchParams.set("client_id", config.clientId);
  u.searchParams.set("post_logout_redirect_uri", opts.postLogoutRedirectUri);
  return u.toString();
}
