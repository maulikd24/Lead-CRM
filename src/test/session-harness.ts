/**
 * Minimal session/authz test harness: lets a test call a route handler or server action as a chosen user (or as nobody)
 * without NextAuth, cookies or a database.
 *
 * Usage, at the top of a test file (vi.mock calls are hoisted, so the factories import this file lazily):
 *
 *   vi.mock("@/lib/auth/config", async () => (await import("@/test/session-harness")).authModule());
 *   vi.mock("next/navigation", async () => (await import("@/test/session-harness")).navigationModule());
 *   vi.mock("next/cache", async () => (await import("@/test/session-harness")).cacheModule());
 *
 *   beforeEach(() => resetSession());
 *   asUser({ role: "RM" });                       // the next calls see this session
 *   const r = await outcomeOf(() => someAction()); // r.kind: "returned" | "redirect" | "notFound" | "threw"
 *
 * `redirect()` and `notFound()` throw like the real ones do, so a gate that fires shows up as `redirect` / `notFound`
 * instead of silently continuing. Only the session is faked; each test still injects its own fake data layer.
 */
import { vi } from "vitest";

import type { Role } from "@/generated/prisma/client";

export type FakeUser = { id: string; role: Role; email: string; name: string; mustChangePassword: boolean };
export type FakeSession = { user: FakeUser; expires: string } | null;

let current: FakeSession = null;

/** Sign in as this user for the following calls. Unspecified fields get safe defaults. */
export function asUser(user: Partial<FakeUser> & { role: Role }): FakeUser {
  const full: FakeUser = {
    id: user.id ?? `user-${user.role.toLowerCase()}`,
    role: user.role,
    email: user.email ?? `${user.role.toLowerCase()}@example.test`,
    name: user.name ?? `Test ${user.role}`,
    mustChangePassword: user.mustChangePassword ?? false,
  };
  current = { user: full, expires: "2999-01-01T00:00:00.000Z" };
  return full;
}

/** No session at all. */
export function asAnonymous(): void {
  current = null;
}

export function resetSession(): void {
  current = null;
}

/** What `redirect(url)` threw. */
export class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

/** What `notFound()` threw. */
export class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

/** Replacement for "@/lib/auth/config". */
export function authModule() {
  return { auth: async () => current, signIn: vi.fn(), signOut: vi.fn(), handlers: {} };
}

/** Replacement for "next/navigation". */
export function navigationModule() {
  return {
    redirect: (url: string): never => {
      throw new RedirectSignal(url);
    },
    notFound: (): never => {
      throw new NotFoundSignal();
    },
  };
}

/** Replacement for "next/cache"; the spies are what the action asked to revalidate. */
export function cacheModule() {
  return { revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: <T>(fn: T) => fn };
}

export type Outcome<T> =
  | { kind: "returned"; value: T }
  | { kind: "redirect"; url: string }
  | { kind: "notFound" }
  | { kind: "threw"; error: unknown };

/** Runs a handler/action and classifies how it ended, so a test can assert "this role gets bounced" in one line. */
export async function outcomeOf<T>(run: () => Promise<T> | T): Promise<Outcome<T>> {
  try {
    return { kind: "returned", value: await run() };
  } catch (error) {
    if (error instanceof RedirectSignal) return { kind: "redirect", url: error.url };
    if (error instanceof NotFoundSignal) return { kind: "notFound" };
    return { kind: "threw", error };
  }
}

/** A multipart form from a plain object, for server actions that take FormData. */
export function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
