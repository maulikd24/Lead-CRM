import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  loginAttempt: { create: vi.fn(), count: vi.fn() },
}));
const logUserEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock, basePrisma: prismaMock }));
vi.mock("@/lib/activity/log-user-event", () => ({
  getRequestMeta: async () => ({ ipAddress: null, userAgent: null }),
  logUserEvent,
}));
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));

import { clockTolerance } from "oauth4webapi";

import { buildAuthConfig } from "./config";

const SSO_ENV = {
  SSO_ENABLED: "1",
  KEYCLOAK_ISSUER: "https://id.example.com/realms/main",
  KEYCLOAK_CLIENT_ID: "crm",
  KEYCLOAK_CLIENT_SECRET: "s3cret",
};
const dbUser = { id: "u1", email: "Jane@Example.com", name: "Jane", role: "RM", isActive: true, lockedUntil: null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...a: any[]) => any;
const cb = (env: Record<string, string | undefined>) => buildAuthConfig(env).callbacks as Record<string, AnyFn>;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.loginAttempt.create.mockResolvedValue({});
  prismaMock.user.update.mockResolvedValue({});
  prismaMock.loginAttempt.count.mockResolvedValue(0);
});

describe("buildAuthConfig without SSO (unchanged behaviour)", () => {
  it("has only the credentials provider and the default session lifetime", () => {
    for (const env of [{}, { SSO_ENABLED: "1" }, { KEYCLOAK_ISSUER: SSO_ENV.KEYCLOAK_ISSUER }]) {
      const c = buildAuthConfig(env);
      expect(c.providers).toHaveLength(1);
      expect(c.session).toEqual({ strategy: "jwt" });
    }
  });
  it("refuses any keycloak sign-in", async () => {
    expect(await cb({}).signIn({ user: {}, account: { provider: "keycloak" }, profile: {} })).toBe(false);
  });
  it("lets credentials sign-ins through the signIn callback (authorize already checked them)", async () => {
    expect(await cb({}).signIn({ user: {}, account: { provider: "credentials" } })).toBe(true);
  });
});

describe("buildAuthConfig with SSO", () => {
  it("adds the keycloak provider with pinned issuer, PKCE+state+nonce, clock tolerance and a bounded session", () => {
    const c = buildAuthConfig(SSO_ENV);
    expect(c.session).toEqual({ strategy: "jwt", maxAge: 8 * 60 * 60 });
    expect(c.providers).toHaveLength(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kc = (c.providers as any[]).find((p) => p.id === "keycloak");
    expect(kc).toBeTruthy();
    const o = kc.options;
    expect(o.issuer).toBe(SSO_ENV.KEYCLOAK_ISSUER);
    expect(o.clientId).toBe("crm");
    expect(o.checks).toEqual(["pkce", "state", "nonce"]);
    expect(o.client[clockTolerance]).toBe(30);
    expect(c.pages).toMatchObject({ signIn: "/login", error: "/login" });
  });

  it("builds without any network access", () => {
    const f = vi.spyOn(globalThis, "fetch");
    buildAuthConfig(SSO_ENV);
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });

  describe("signIn callback", () => {
    const profile = (o: object = {}) => ({ iss: SSO_ENV.KEYCLOAK_ISSUER, email: "jane@example.com", email_verified: true, ...o });
    const run = (p: unknown, user: Record<string, unknown> = {}) => {
      const u = { id: "kc-sub", name: "x", email: "x@y.z", ...user } as Record<string, unknown>;
      return cb(SSO_ENV)
        .signIn({ user: u, account: { provider: "keycloak" }, profile: p })
        .then((ok: boolean) => ({ ok, u }));
    };
    const failure = () => logUserEvent.mock.calls.map((c) => c[0]).find((e) => e.type === "LOGIN_FAILED");

    it("signs in an existing active user, using database id/role/name/email and updating lastLoginAt", async () => {
      prismaMock.user.findMany.mockResolvedValue([dbUser]);
      const { ok, u } = await run(profile({ role: "ADMIN", roles: ["ADMIN"] }));
      expect(ok).toBe(true);
      expect(u).toMatchObject({ id: "u1", role: "RM", name: "Jane", email: "Jane@Example.com" });
      expect(prismaMock.user.findMany.mock.calls[0][0].where.email).toEqual({ equals: "jane@example.com", mode: "insensitive" });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { lastLoginAt: expect.any(Date), failedLoginAttempts: 0 },
      });
      expect(logUserEvent.mock.calls[0][0]).toMatchObject({ type: "LOGIN_SUCCESS", userId: "u1" });
    });

    it("does not auto-provision: unknown email is refused, audited, and no user is created", async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      const { ok } = await run(profile({ email: "stranger@example.com" }));
      expect(ok).toBe(false);
      expect(failure()).toMatchObject({ userEmail: "stranger@example.com", details: { reason: "sso_unknown_user" } });
      expect(prismaMock.loginAttempt.create.mock.calls[0][0].data).toMatchObject({ success: false, userId: null });
      expect(Object.keys(prismaMock.user)).not.toContain("create");
    });

    it.each([
      ["inactive", { isActive: false }, "sso_inactive_user"],
      ["locked", { lockedUntil: new Date(Date.now() + 60_000) }, "sso_account_locked"],
    ])("refuses %s users", async (_n, patch, reason) => {
      prismaMock.user.findMany.mockResolvedValue([{ ...dbUser, ...patch }]);
      const { ok } = await run(profile());
      expect(ok).toBe(false);
      expect(failure()).toMatchObject({ details: { reason } });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("refuses unverified or missing email without touching the user table", async () => {
      expect((await run(profile({ email_verified: false }))).ok).toBe(false);
      expect((await run(profile({ email_verified: undefined }))).ok).toBe(false);
      expect((await run({ iss: SSO_ENV.KEYCLOAK_ISSUER, email_verified: true })).ok).toBe(false);
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    });

    it("pins the issuer", async () => {
      prismaMock.user.findMany.mockResolvedValue([dbUser]);
      for (const iss of [undefined, "https://evil.example.com/realms/main", "https://id.example.com/realms/other"]) {
        expect((await run(profile({ iss }))).ok).toBe(false);
      }
      expect(failure()).toMatchObject({ details: { reason: "sso_issuer_mismatch" } });
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    });

    it("never logs tokens or claims beyond the email already logged by the credentials login", async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      await run(profile({ email: "x@example.com", access_token: "AT-SECRET", id_token: "IDT-SECRET", name: "Some Name" }));
      const blob = JSON.stringify([logUserEvent.mock.calls, prismaMock.loginAttempt.create.mock.calls]);
      expect(blob).not.toContain("SECRET");
      expect(blob).not.toContain("Some Name");
    });
  });

  describe("jwt callback", () => {
    it("sets id/role/authTime/sso and keeps the id token on SSO sign-in", async () => {
      const before = Date.now();
      const t = await cb(SSO_ENV).jwt({ token: {}, user: { id: "u1", role: "RM" }, account: { provider: "keycloak", id_token: "IDT" } });
      expect(t).toMatchObject({ id: "u1", role: "RM", sso: true, idToken: "IDT" });
      expect(t.authTime).toBeGreaterThanOrEqual(before);
    });
    it("credentials sign-in sets authTime and no sso flag", async () => {
      const t = await cb(SSO_ENV).jwt({ token: {}, user: { id: "u1", role: "RM" }, account: { provider: "credentials" } });
      expect(t.authTime).toBeTypeOf("number");
      expect(t.sso).toBeUndefined();
      expect(t.idToken).toBeUndefined();
    });
    it("SSO sessions never need a password change; credentials sessions still do", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        role: "RM",
        isActive: true,
        name: "J",
        email: "j@e.co",
        mustChangePassword: true,
        sessionsValidFrom: null,
      });
      expect((await cb(SSO_ENV).jwt({ token: { id: "u1", authTime: Date.now(), sso: true } })).mustChangePassword).toBe(false);
      expect((await cb(SSO_ENV).jwt({ token: { id: "u1", authTime: Date.now() } })).mustChangePassword).toBe(true);
    });
    it("honours sessionsValidFrom for SSO sessions, and re-reads role from the database", async () => {
      const t0 = Date.now() - 10_000;
      prismaMock.user.findUnique.mockResolvedValue({
        role: "MANAGER",
        isActive: true,
        name: "J",
        email: "j@e.co",
        mustChangePassword: false,
        sessionsValidFrom: new Date(t0 + 5_000),
      });
      expect(await cb(SSO_ENV).jwt({ token: { id: "u1", authTime: t0, sso: true, role: "ADMIN" } })).toBeNull();
      prismaMock.user.findUnique.mockResolvedValue({
        role: "MANAGER",
        isActive: true,
        name: "J",
        email: "j@e.co",
        mustChangePassword: false,
        sessionsValidFrom: new Date(t0 - 5_000),
      });
      expect((await cb(SSO_ENV).jwt({ token: { id: "u1", authTime: t0, sso: true, role: "ADMIN" } })).role).toBe("MANAGER");
    });
    it("ends the session when the user is deactivated", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        role: "RM",
        isActive: false,
        name: "J",
        email: "j@e.co",
        mustChangePassword: false,
        sessionsValidFrom: null,
      });
      expect(await cb(SSO_ENV).jwt({ token: { id: "u1", authTime: Date.now(), sso: true } })).toBeNull();
    });
  });

  describe("session callback", () => {
    it("exposes the usual shape and never the id token", async () => {
      const s = await cb(SSO_ENV).session({
        session: { user: {} },
        token: { id: "u1", role: "RM", name: "J", email: "j@e.co", sso: true, idToken: "IDT" },
      });
      expect(s.user).toEqual({ id: "u1", role: "RM", name: "J", email: "j@e.co", mustChangePassword: false });
      expect(JSON.stringify(s)).not.toContain("IDT");
    });
  });

  describe("redirect callback (no open redirects)", () => {
    const r = (url: string) => cb(SSO_ENV).redirect({ url, baseUrl: "https://crm.example.com" });
    it("keeps same-origin targets, blocks everything else", () => {
      expect(r("/clients")).toBe("https://crm.example.com/clients");
      expect(r("https://crm.example.com/clients")).toBe("https://crm.example.com/clients");
      expect(r("https://evil.example.com/")).toBe("https://crm.example.com");
      expect(r("//evil.example.com")).toBe("https://crm.example.com");
    });
    it("allows only the configured provider logout endpoint as an external target", () => {
      const ok = "https://id.example.com/realms/main/protocol/openid-connect/logout?client_id=crm";
      expect(r(ok)).toBe(ok);
      expect(r("https://id.example.com/realms/other/protocol/openid-connect/logout")).toBe("https://crm.example.com");
    });
  });

  describe("credentials provider under SSO_ONLY", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authorize = (env: Record<string, string | undefined>): AnyFn => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (buildAuthConfig(env).providers as any[]).find((x) => (x.id ?? x.options?.id) === "credentials");
      return p.options?.authorize ?? p.authorize;
    };
    it("refuses credentials for non-break-glass users before touching the database, and audits it", async () => {
      const a = authorize({ ...SSO_ENV, SSO_ONLY: "1", SSO_BREAK_GLASS_EMAILS: "root@example.com" });
      expect(await a({ email: "rm@example.com", password: "pw" })).toBeNull();
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(logUserEvent.mock.calls[0][0]).toMatchObject({ type: "LOGIN_FAILED", details: { reason: "sso_required" } });
    });
    it("lets a break-glass email reach the normal password check", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      const a = authorize({ ...SSO_ENV, SSO_ONLY: "1", SSO_BREAK_GLASS_EMAILS: "root@example.com" });
      expect(await a({ email: "root@example.com", password: "pw" })).toBeNull();
      expect(prismaMock.user.findUnique).toHaveBeenCalled();
      expect(logUserEvent.mock.calls[0][0]).toMatchObject({ details: { reason: "unknown_or_inactive_user" } });
    });
    it("is unrestricted when SSO_ONLY is not set", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await authorize(SSO_ENV)({ email: "rm@example.com", password: "pw" });
      expect(prismaMock.user.findUnique).toHaveBeenCalled();
    });
  });
});
