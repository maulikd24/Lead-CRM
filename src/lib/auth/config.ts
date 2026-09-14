import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma/client";

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
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}

// Lockout: after this many consecutive failures, further attempts are rejected (even with the
// correct password) until lockedUntil passes. Deliberately simple — no IP allowlisting here (see
// the plan's "Security hardening — built vs. deferred": this app has no middleware.ts, so there's
// no reliable request-IP plumbing to enforce one yet).
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

async function recordLoginAttempt(email: string, userId: string | null, success: boolean) {
  try {
    await prisma.loginAttempt.create({ data: { email, userId, success } });
  } catch (error) {
    console.error("Failed to record LoginAttempt", error);
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          await recordLoginAttempt(email, null, false);
          return null;
        }

        if (user.lockedUntil && user.lockedUntil > new Date()) {
          // Still locked — reject without even checking the password, and without counting this
          // as an additional failure (the lockout window itself is the deterrent).
          await recordLoginAttempt(email, user.id, false);
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
          await recordLoginAttempt(email, user.id, false);
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
        });
        await recordLoginAttempt(email, user.id, true);

        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user?.id) {
        // Initial sign-in: NextAuth provides `user` from authorize().
        token.id = user.id;
        token.role = user.role;
        return token;
      }

      if (!token.id) return null;

      // Every subsequent request: re-fetch current role/active status/name/email
      // so admin changes and self-service profile edits take effect on the
      // user's very next request instead of only after they next log in.
      const current = await prisma.user.findUnique({
        where: { id: token.id },
        select: { role: true, isActive: true, name: true, email: true },
      });
      if (!current || !current.isActive) return null;

      token.role = current.role;
      token.name = current.name;
      token.email = current.email;
      return token;
    },
    session: async ({ session, token }) => {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.name = token.name ?? session.user.name;
      session.user.email = token.email ?? session.user.email;
      return session;
    },
  },
});
