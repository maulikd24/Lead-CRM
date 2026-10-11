import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  loginAttempt: { create: vi.fn(), count: vi.fn() },
  integrationConfig: { findUnique: vi.fn() },
}));
const logUserEvent = vi.hoisted(() => vi.fn());
const meta = vi.hoisted(() => ({ ipAddress: "10.0.0.1" as string | null }));
vi.mock("@/lib/db/prisma", () => ({ prisma: prismaMock, basePrisma: prismaMock }));
vi.mock("@/lib/activity/log-user-event", () => ({
  getRequestMeta: async () => ({ ipAddress: meta.ipAddress, userAgent: null }),
  logUserEvent,
}));
vi.mock("next-auth", () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));

import { buildAuthConfig } from "./config";

const ENV = { GOOGLE_SIGNIN_ENABLED: "1", GOOGLE_CLIENT_ID: "fake-id", GOOGLE_CLIENT_SECRET: "fake-secret" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...a: any[]) => any;
const cb = (env: Record<string, string | undefined>) => buildAuthConfig(env).callbacks as Record<string, AnyFn>;
const dbUser = { id: "u1", email: "ria@corp.example", name: "Ria", role: "MARKETING", isActive: true, lockedUntil: null };
const googleProfile = { email: "ria@corp.example", email_verified: true, hd: "corp.example" };
const attempt = (profile: unknown = googleProfile, user: Record<string, unknown> = {}) => cb(ENV).signIn({ user, account: { provider: "google" }, profile });

beforeEach(() => {
  vi.clearAllMocks();
  meta.ipAddress = "10.0.0.1";
  prismaMock.loginAttempt.create.mockResolvedValue({});
  prismaMock.loginAttempt.count.mockResolvedValue(0);
  prismaMock.user.update.mockResolvedValue({});
  prismaMock.user.findMany.mockResolvedValue([dbUser]);
  prismaMock.integrationConfig.findUnique.mockResolvedValue({ settings: { allowedDomains: ["corp.example"] } });
});

describe("Google provider with the flag off (unchanged behaviour)", () => {
  it("adds no provider and refuses any google sign-in", async () => {
    for (const env of [{}, { GOOGLE_SIGNIN_ENABLED: "1" }, { ...ENV, GOOGLE_SIGNIN_ENABLED: "0" }]) {
      expect(buildAuthConfig(env).providers).toHaveLength(1);
      expect(await cb(env).signIn({ user: {}, account: { provider: "google" }, profile: googleProfile })).toBe(false);
    }
    expect(Object.keys(buildAuthConfig({}).callbacks as object).sort()).toEqual(["jwt", "session", "signIn"]);
    expect(buildAuthConfig({}).pages).toEqual({ signIn: "/login" });
  });
});

describe("Google provider with the flag on", () => {
  it("adds the google provider with PKCE and state, same-origin redirects and the login error page", () => {
    const c = buildAuthConfig(ENV);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (c.providers as any[]).find((p) => p.id === "google");
    expect(g).toBeTruthy();
    expect(g.options.clientId).toBe("fake-id");
    expect(g.options.checks).toEqual(expect.arrayContaining(["pkce", "state"]));
    expect(c.pages).toMatchObject({ signIn: "/login", error: "/login" });
    expect(typeof (c.callbacks as Record<string, unknown>).redirect).toBe("function");
  });
  it("lets an existing active user in; id, role, name and email come from the database", async () => {
    const u: Record<string, unknown> = { role: "ADMIN", name: "Evil" };
    expect(await attempt(googleProfile, u)).toBe(true);
    expect(u).toMatchObject({ id: "u1", role: "MARKETING", name: "Ria", email: "ria@corp.example" });
    expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u1" } }));
    expect(prismaMock.loginAttempt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ success: true, userId: "u1" }) });
  });
  it("never creates a user", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    expect(await attempt()).toBe(false);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock).not.toHaveProperty("user.create");
  });
  it("is closed while the allow-list is empty (the default) and never queries users", async () => {
    prismaMock.integrationConfig.findUnique.mockResolvedValue(null);
    expect(await attempt()).toBe(false);
    prismaMock.integrationConfig.findUnique.mockResolvedValue({ settings: { allowedDomains: [] } });
    expect(await attempt()).toBe(false);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });
  it("records every refusal as a failed attempt with a reason for the audit trail only", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ ...dbUser, isActive: false }]);
    expect(await attempt()).toBe(false);
    expect(prismaMock.loginAttempt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ success: false, email: "ria@corp.example" }) });
    expect(logUserEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "LOGIN_FAILED", details: expect.objectContaining({ reason: "google_inactive_user" }) }));
  });
  it("honours the per-IP failure rate limit before looking anything up", async () => {
    prismaMock.loginAttempt.count.mockResolvedValue(50);
    expect(await attempt()).toBe(false);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(logUserEvent).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ reason: "ip_rate_limited" }) }));
  });
  it("does not break credentials or keycloak behaviour", async () => {
    expect(await cb(ENV).signIn({ user: {}, account: { provider: "credentials" } })).toBe(true);
    expect(await cb(ENV).signIn({ user: {}, account: { provider: "keycloak" }, profile: {} })).toBe(false);
  });
  it("marks the session as federated like SSO so the password-change prompt does not apply", async () => {
    const t = await cb(ENV).jwt({ token: {}, user: { id: "u1", role: "MARKETING" }, account: { provider: "google" } });
    expect(t).toMatchObject({ id: "u1", role: "MARKETING" });
    expect(t.sso).toBeUndefined();
    expect(t.federated).toBe("google");
  });
});
