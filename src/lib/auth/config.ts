import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Keycloak from "next-auth/providers/keycloak";
// oauth4webapi ships with @auth/core (hoisted); we only need its clock-tolerance symbol for the OIDC client.
import { clockTolerance } from "oauth4webapi";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";
import { getRequestMeta, logUserEvent } from "@/lib/activity/log-user-event";
import type { Role } from "@/generated/prisma/client";
import {
  credentialsAllowed,
  endSessionEndpoint,
  issuerMatches,
  matchSsoUser,
  safeRedirect,
  ssoConfigFromEnv,
  type SsoMatchFailure,
} from "@/lib/auth/sso";

declare module "next-auth" {
  interface User {
    role: Role;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      name: string;
      email: string;
      mustChangePassword: boolean;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    /** When this session signed in (ms). Sessions older than User.sessionsValidFrom are rejected. */
    authTime?: number;
    mustChangePassword?: boolean;
    /** Signed in through the identity provider (SSO), not a local password. */
    sso?: boolean;
    /** Kept only to send id_token_hint on provider sign-out; never copied into the client-visible session. */
    idToken?: string;
  }
}

// Lockout: after this many consecutive failures, further attempts are rejected (even with the
// correct password) until lockedUntil passes. Deliberately simple — no IP allowlisting here (see
// the plan's "Security hardening — built vs. deferred": this app has no middleware.ts, so there's
// no reliable request-IP plumbing to enforce one yet).
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

const IP_FAILURE_LIMIT = 50;
const IP_FAILURE_WINDOW_MS = 15 * 60 * 1000;

async function recordLoginAttempt(
  email: string,
  user: { id: string; role: Role } | null,
  success: boolean,
  failureReason?:
    | "unknown_or_inactive_user"
    | "account_locked"
    | "wrong_password"
    | "ip_rate_limited"
    | "sso_required"
    | `sso_${SsoMatchFailure}`
    | "sso_issuer_mismatch",
) {
  try {
    const meta = await getRequestMeta();
    await prisma.loginAttempt.create({
      data: {
        email,
        userId: user?.id ?? null,
        success,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
  } catch (error) {
    console.error("Failed to record LoginAttempt", error);
  }
  await logUserEvent({
    userId: user?.id ?? null,
    userEmail: email,
    userRole: user?.role ?? null,
    type: success ? "LOGIN_SUCCESS" : "LOGIN_FAILED",
    summary: success ? "Signed in" : `Sign-in failed (${failureReason?.replace(/_/g, " ")})`,
    details: failureReason ? { reason: failureReason } : undefined,
  });
}

// With SSO enabled, sessions are re-validated against the database on every request but have no refresh
// token: they simply end after this long and the user signs in again (a quick redirect while the provider
// session lives). Without SSO the NextAuth default (30 days) is left untouched.
const SSO_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
// Tolerated clock difference between this server and the identity provider when checking exp/iat/nbf.
const SSO_CLOCK_TOLERANCE_SECONDS = 30;

/** Builds the NextAuth config. Takes the env as a parameter so tests can build it with fake values and no network. */
export function buildAuthConfig(env: Record<string, string | undefined> = process.env): NextAuthConfig {
  const sso = ssoConfigFromEnv(env);
  const providers: NextAuthConfig["providers"] = [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        // SSO_ONLY: credentials sign-in is refused for everyone except the documented break-glass list.
        if (!credentialsAllowed(email, sso)) {
          await recordLoginAttempt(email, null, false, "sso_required");
          return null;
        }

        // Per-account lockout (below) doesn't stop one IP spraying a common password across many accounts.
        // Count only *failed* attempts per IP, so an office of RMs behind one NAT address isn't throttled.
        const { ipAddress } = await getRequestMeta();
        if (ipAddress) {
          const recentFailures = await prisma.loginAttempt.count({
            where: {
              ipAddress,
              success: false,
              attemptedAt: { gte: new Date(Date.now() - IP_FAILURE_WINDOW_MS) },
            },
          });
          if (recentFailures >= IP_FAILURE_LIMIT) {
            await recordLoginAttempt(email, null, false, "ip_rate_limited");
            return null;
          }
        }

        const user = await prisma.user.findUnique({
          where: { email },
          omit: { passwordHash: false },
        });
        if (!user || !user.isActive) {
          await recordLoginAttempt(email, null, false, "unknown_or_inactive_user");
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
          // Still locked — reject without even checking the password, and without counting this
          // as an additional failure (the lockout window itself is the deterrent).
          await recordLoginAttempt(email, user, false, "account_locked");
          return null;
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          const failedLoginAttempts = user.failedLoginAttempts + 1;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts,
              lockedUntil: failedLoginAttempts >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedUntil,
            },
          });
          await recordLoginAttempt(email, user, false, "wrong_password");
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        });
        await recordLoginAttempt(email, user, true);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ];

  if (sso.enabled) {
    providers.push(
      Keycloak({
        clientId: sso.clientId,
        clientSecret: sso.clientSecret,
        // Discovery runs against this issuer and Auth.js rejects metadata whose issuer differs; the signIn
        // callback below pins the id token's `iss` to the same value.
        issuer: sso.issuer,
        checks: ["pkce", "state", "nonce"],
        authorization: { params: { scope: "openid email profile" } },
        client: {
          token_endpoint_auth_method: "client_secret_basic",
          [clockTolerance]: SSO_CLOCK_TOLERANCE_SECONDS,
        },
      }),
    );
  }

  return {
    session: sso.enabled ? { strategy: "jwt", maxAge: SSO_SESSION_MAX_AGE_SECONDS } : { strategy: "jwt" },
    pages: { signIn: "/login", error: "/login" },
    providers,
    callbacks: {
      signIn: async ({ user, account, profile }) => {
        // Credentials sign-ins were already fully checked in authorize().
        if (account?.provider !== "keycloak") return true;
        if (!sso.enabled) return false;

        const claimEmail = typeof profile?.email === "string" ? profile.email : "(no email claim)";
        if (!issuerMatches(profile?.iss, sso.issuer)) {
          await recordLoginAttempt(claimEmail, null, false, "sso_issuer_mismatch");
          return false;
        }

        const match = await matchSsoUser(profile, {
          now: () => new Date(),
          findUsersByEmail: (email) =>
            prisma.user.findMany({
              where: { email: { equals: email, mode: "insensitive" } },
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
                isActive: true,
                lockedUntil: true,
              },
              take: 3,
            }),
        });
        if (!match.ok) {
          // Unknown email, unverified email, inactive, locked: the user only ever sees one generic "no access" page.
          await recordLoginAttempt(match.email ?? claimEmail, null, false, `sso_${match.reason}`);
          return false;
        }

        await prisma.user.update({
          where: { id: match.user.id },
          data: { lastLoginAt: new Date(), failedLoginAttempts: 0 },
        });
        await recordLoginAttempt(match.user.email, { id: match.user.id, role: match.user.role as Role }, true);
        // Same session shape as the credentials login: id/role/name/email always come from Supportify, never the token.
        user.id = match.user.id;
        user.role = match.user.role as Role;
        user.name = match.user.name;
        user.email = match.user.email;
        return true;
      },
      // Same-origin only; the single external target allowed is the provider's end-session endpoint.
      redirect: ({ url, baseUrl }) => safeRedirect(url, baseUrl, endSessionEndpoint(sso) ?? undefined),
      jwt: async ({ token, user, account }) => {
        if (user?.id) {
          // Initial sign-in: NextAuth provides `user` from authorize() or, for SSO, from the signIn callback above.
          token.id = user.id;
          token.role = user.role;
          token.authTime = Date.now();
          if (account?.provider === "keycloak") {
            token.sso = true;
            if (typeof account.id_token === "string") token.idToken = account.id_token;
          }
          return token;
        }

        if (!token.id) return null;

        // Every subsequent request: re-fetch current role/active status/name/email
        // so admin changes and self-service profile edits take effect on the
        // user's very next request instead of only after they next log in.
        const current = await prisma.user.findUnique({
          where: { id: token.id },
          select: {
            role: true,
            isActive: true,
            name: true,
            email: true,
            mustChangePassword: true,
            sessionsValidFrom: true,
          },
        });
        if (!current || !current.isActive) return null;
        // Signed in before a password change/reset or a forced sign-out: end this session. Tokens issued before
        // authTime existed count as signed in at 0, so they end too.
        if (current.sessionsValidFrom && (token.authTime ?? 0) < current.sessionsValidFrom.getTime()) return null;

        token.role = current.role;
        token.name = current.name;
        token.email = current.email;
        // The identity provider vouches for SSO users, so the local first-login password prompt does not apply to them.
        token.mustChangePassword = token.sso ? false : current.mustChangePassword;
        return token;
      },
      session: async ({ session, token }) => {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.name = token.name ?? session.user.name;
        session.user.email = token.email ?? session.user.email;
        session.user.mustChangePassword = token.mustChangePassword ?? false;
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildAuthConfig());
