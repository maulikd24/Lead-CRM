import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";

import { buildEndSessionUrl, ssoConfigFromEnv } from "@/lib/auth/sso";

const COOKIE_BASES = ["__Secure-authjs.session-token", "authjs.session-token"];

/** Joins the (possibly chunked) session cookie value for one cookie name, or null when absent. */
export function joinSessionCookie(all: { name: string; value: string }[], base: string): string | null {
  const whole = all.find((c) => c.name === base);
  if (whole) return whole.value;
  const chunks = all
    .filter((c) => c.name.startsWith(`${base}.`) && /^\d+$/.test(c.name.slice(base.length + 1)))
    .sort((a, b) => Number(a.name.slice(base.length + 1)) - Number(b.name.slice(base.length + 1)));
  return chunks.length ? chunks.map((c) => c.value).join("") : null;
}

/**
 * Where to send the browser after a local sign-out so the identity-provider session ends too (RP-initiated
 * logout), or null when SSO is off, the user did not sign in through SSO, or anything fails. Fails safe: the
 * caller always signs out locally regardless. The id token is only ever put in the logout URL.
 */
export async function ssoEndSessionUrl(env: Record<string, string | undefined>, postLogoutRedirectUri: string): Promise<string | null> {
  const config = ssoConfigFromEnv(env);
  if (!config.enabled) return null;
  try {
    const jar = (await cookies()).getAll();
    for (const base of COOKIE_BASES) {
      const raw = joinSessionCookie(jar, base);
      if (!raw || !env.AUTH_SECRET) continue;
      const token = await decode({ token: raw, secret: env.AUTH_SECRET, salt: base });
      if (token?.sso !== true) return null;
      return buildEndSessionUrl(config, {
        idTokenHint: typeof token.idToken === "string" ? token.idToken : undefined,
        postLogoutRedirectUri,
      });
    }
  } catch {
    // fall through to a plain local sign-out
  }
  return null;
}
