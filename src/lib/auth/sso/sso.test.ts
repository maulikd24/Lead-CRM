import { describe, expect, it, vi } from "vitest";

import {
  ssoConfigFromEnv,
  normalizeEmail,
  isEmailAllowed,
  issuerMatches,
  safeCallbackUrl,
  safeRedirect,
  credentialsAllowed,
  matchSsoUser,
  buildEndSessionUrl,
  type SsoUserRecord,
} from "./index";

const FULL = {
  SSO_ENABLED: "1",
  KEYCLOAK_ISSUER: "https://id.example.com/realms/main",
  KEYCLOAK_CLIENT_ID: "crm",
  KEYCLOAK_CLIENT_SECRET: "s3cret",
};

describe("ssoConfigFromEnv", () => {
  it("is disabled when the flag is unset", () => {
    expect(ssoConfigFromEnv({}).enabled).toBe(false);
    expect(ssoConfigFromEnv({ ...FULL, SSO_ENABLED: undefined }).enabled).toBe(false);
  });
  it("is disabled unless the flag is exactly 1", () => {
    for (const v of ["0", "true", "yes", " 1", ""]) expect(ssoConfigFromEnv({ ...FULL, SSO_ENABLED: v }).enabled).toBe(false);
  });
  it.each(["KEYCLOAK_ISSUER", "KEYCLOAK_CLIENT_ID", "KEYCLOAK_CLIENT_SECRET"])("is disabled when %s is missing or blank", (k) => {
    expect(ssoConfigFromEnv({ ...FULL, [k]: undefined }).enabled).toBe(false);
    expect(ssoConfigFromEnv({ ...FULL, [k]: "   " }).enabled).toBe(false);
  });
  it("is disabled for a non-https, non-loopback issuer or a malformed one", () => {
    expect(ssoConfigFromEnv({ ...FULL, KEYCLOAK_ISSUER: "http://id.example.com/realms/main" }).enabled).toBe(false);
    expect(ssoConfigFromEnv({ ...FULL, KEYCLOAK_ISSUER: "not a url" }).enabled).toBe(false);
    expect(ssoConfigFromEnv({ ...FULL, KEYCLOAK_ISSUER: "javascript:alert(1)" }).enabled).toBe(false);
    expect(ssoConfigFromEnv({ ...FULL, KEYCLOAK_ISSUER: "http://localhost:8080/realms/t" }).enabled).toBe(true);
  });
  it("enables with a full env and strips one trailing slash from the issuer", () => {
    const c = ssoConfigFromEnv({ ...FULL, KEYCLOAK_ISSUER: "https://id.example.com/realms/main/" });
    expect(c).toMatchObject({
      enabled: true,
      issuer: "https://id.example.com/realms/main",
      clientId: "crm",
      clientSecret: "s3cret",
      ssoOnly: false,
    });
  });
  it("parses SSO_ONLY and the break-glass list (lowercased, trimmed, empties dropped)", () => {
    const c = ssoConfigFromEnv({ ...FULL, SSO_ONLY: "1", SSO_BREAK_GLASS_EMAILS: " Admin@Example.com, ,ops@example.com " });
    expect(c.ssoOnly).toBe(true);
    expect(c.breakGlass).toEqual(["admin@example.com", "ops@example.com"]);
  });
  it("ignores SSO_ONLY when SSO itself is not enabled (never locks everyone out)", () => {
    const c = ssoConfigFromEnv({ SSO_ONLY: "1" });
    expect(c.enabled).toBe(false);
    expect(c.ssoOnly).toBe(false);
  });
});

describe("normalizeEmail / isEmailAllowed", () => {
  it("trims and lowercases but keeps plus-suffixes (deliberate)", () => {
    expect(normalizeEmail("  Jane+Crm@Example.COM ")).toBe("jane+crm@example.com");
  });
  it("requires a present string email and email_verified === true", () => {
    expect(isEmailAllowed({ email: "a@b.co", email_verified: true })).toEqual({ ok: true, email: "a@b.co" });
    expect(isEmailAllowed({ email: "a@b.co" }).ok).toBe(false);
    expect(isEmailAllowed({ email: "a@b.co", email_verified: false }).ok).toBe(false);
    for (const v of ["true", 1, "1", null, {}]) expect(isEmailAllowed({ email: "a@b.co", email_verified: v as never }).ok).toBe(false);
    for (const e of [undefined, null, "", "   ", 5, "no-at-sign", "a@@b.co", "a b@c.co"])
      expect(isEmailAllowed({ email: e as never, email_verified: true }).ok).toBe(false);
    expect(isEmailAllowed(null).ok).toBe(false);
    expect(isEmailAllowed(undefined).ok).toBe(false);
  });
  it("rejects an absurdly long email", () => {
    expect(isEmailAllowed({ email: "a".repeat(300) + "@b.co", email_verified: true }).ok).toBe(false);
  });
});

describe("issuerMatches", () => {
  it("pins the issuer exactly (one trailing slash tolerated)", () => {
    expect(issuerMatches("https://id.example.com/realms/main", "https://id.example.com/realms/main")).toBe(true);
    expect(issuerMatches("https://id.example.com/realms/main/", "https://id.example.com/realms/main")).toBe(true);
    expect(issuerMatches("https://id.example.com/realms/other", "https://id.example.com/realms/main")).toBe(false);
    expect(issuerMatches("https://evil.example.com/realms/main", "https://id.example.com/realms/main")).toBe(false);
    expect(issuerMatches("HTTPS://ID.EXAMPLE.COM/realms/main", "https://id.example.com/realms/main")).toBe(false);
    expect(issuerMatches(undefined, "https://id.example.com/realms/main")).toBe(false);
    expect(issuerMatches(["https://id.example.com/realms/main"] as never, "https://id.example.com/realms/main")).toBe(false);
  });
});

describe("safeCallbackUrl", () => {
  it("keeps same-origin paths", () => {
    expect(safeCallbackUrl("/clients?x=1#h")).toBe("/clients?x=1#h");
    expect(safeCallbackUrl("/dashboard")).toBe("/dashboard");
  });
  it("falls back for everything else", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "dashboard",
      "//evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "https://evil.com",
      "http://localhost:3103/x",
      "javascript:alert(1)",
      "/\t/evil.com",
      "/\n/evil.com",
      "/%2F%2Fevil.com",
      "/..//evil.com",
      "data:text/html,x",
      42,
      ["/a"],
    ]) {
      expect(safeCallbackUrl(bad as never)).toBe("/dashboard");
    }
  });
  it("uses a given safe fallback", () => {
    expect(safeCallbackUrl("//x", "/dealer-desk")).toBe("/dealer-desk");
  });
  it("does not allow the login page itself as a target loop", () => {
    expect(safeCallbackUrl("/login")).toBe("/dashboard");
    expect(safeCallbackUrl("/api/auth/signout")).toBe("/dashboard");
  });
});

describe("safeRedirect (NextAuth redirect callback)", () => {
  const base = "http://localhost:3103";
  it("allows relative paths and same-origin URLs", () => {
    expect(safeRedirect("/clients", base)).toBe("http://localhost:3103/clients");
    expect(safeRedirect("http://localhost:3103/clients", base)).toBe("http://localhost:3103/clients");
  });
  it("blocks other origins and tricks", () => {
    for (const u of [
      "https://evil.com",
      "//evil.com",
      "http://localhost:3103.evil.com/x",
      "http://localhost:31033/x",
      "javascript:alert(1)",
    ])
      expect(safeRedirect(u, base)).toBe(base);
  });
  it("allows only the configured end-session endpoint as an external target", () => {
    const ext = "https://id.example.com/realms/main/protocol/openid-connect/logout";
    expect(safeRedirect(`${ext}?client_id=crm`, base, ext)).toBe(`${ext}?client_id=crm`);
    expect(safeRedirect("https://id.example.com/realms/main/protocol/openid-connect/logout/../../evil", base, ext)).toBe(base);
    expect(safeRedirect(`${ext}x`, base, ext)).toBe(base);
    expect(safeRedirect(`${ext}?client_id=crm`, base)).toBe(base);
  });
});

describe("credentialsAllowed", () => {
  const cfg = (o: object) => ssoConfigFromEnv({ ...FULL, ...o });
  it("allows everyone unless SSO_ONLY", () => {
    expect(credentialsAllowed("a@b.co", cfg({}))).toBe(true);
    expect(credentialsAllowed("a@b.co", ssoConfigFromEnv({}))).toBe(true);
  });
  it("under SSO_ONLY only break-glass emails (case-insensitive) may use credentials", () => {
    const c = cfg({ SSO_ONLY: "1", SSO_BREAK_GLASS_EMAILS: "Root@Example.com" });
    expect(credentialsAllowed("root@example.com", c)).toBe(true);
    expect(credentialsAllowed(" ROOT@example.COM ", c)).toBe(true);
    expect(credentialsAllowed("root+x@example.com", c)).toBe(false);
    expect(credentialsAllowed("other@example.com", c)).toBe(false);
    expect(credentialsAllowed("", c)).toBe(false);
  });
  it("under SSO_ONLY with no break-glass list nobody may use credentials", () => {
    expect(credentialsAllowed("a@b.co", cfg({ SSO_ONLY: "1" }))).toBe(false);
  });
});

describe("matchSsoUser", () => {
  const user = (o: Partial<SsoUserRecord> = {}): SsoUserRecord => ({
    id: "u1",
    email: "Jane@Example.com",
    name: "Jane",
    role: "RM" as never,
    isActive: true,
    lockedUntil: null,
    ...o,
  });
  const run = (profile: unknown, users: SsoUserRecord[]) => {
    const findUsersByEmail = vi.fn(async () => users);
    return matchSsoUser(profile as never, { findUsersByEmail, now: () => new Date("2026-01-01T00:00:00Z") }).then((r) => ({
      r,
      findUsersByEmail,
    }));
  };
  it("matches an active user by case-insensitive email and uses the db role", async () => {
    const { r, findUsersByEmail } = await run({ email: " JANE@example.com ", email_verified: true, roles: ["ADMIN"], role: "ADMIN" }, [
      user(),
    ]);
    expect(r).toMatchObject({ ok: true, user: { id: "u1", role: "RM" } });
    expect(findUsersByEmail).toHaveBeenCalledWith("jane@example.com");
  });
  it("does not query the database for an unverified or missing email", async () => {
    const a = await run({ email: "jane@example.com", email_verified: false }, [user()]);
    expect(a.r).toEqual({ ok: false, reason: "email_unverified" });
    expect(a.findUsersByEmail).not.toHaveBeenCalled();
    const b = await run({}, [user()]);
    expect(b.r).toEqual({ ok: false, reason: "invalid_profile" });
    expect(b.findUsersByEmail).not.toHaveBeenCalled();
  });
  it("refuses unknown email (no auto-provisioning)", async () => {
    expect((await run({ email: "new@example.com", email_verified: true }, [])).r).toMatchObject({ ok: false, reason: "unknown_user" });
  });
  it("refuses inactive and locked users", async () => {
    expect((await run({ email: "jane@example.com", email_verified: true }, [user({ isActive: false })])).r).toMatchObject({
      ok: false,
      reason: "inactive_user",
    });
    expect(
      (await run({ email: "jane@example.com", email_verified: true }, [user({ lockedUntil: new Date("2026-01-01T00:10:00Z") })])).r,
    ).toMatchObject({ ok: false, reason: "account_locked" });
  });
  it("allows a user whose lock has expired", async () => {
    expect(
      (await run({ email: "jane@example.com", email_verified: true }, [user({ lockedUntil: new Date("2025-12-31T23:00:00Z") })])).r.ok,
    ).toBe(true);
  });
  it("refuses when two accounts differ only by case (ambiguous)", async () => {
    expect(
      (await run({ email: "jane@example.com", email_verified: true }, [user(), user({ id: "u2", email: "JANE@example.com" })])).r,
    ).toMatchObject({ ok: false, reason: "ambiguous_user" });
  });
  it("does not match a plus-suffixed variant of an existing email", async () => {
    const findUsersByEmail = vi.fn(async (e: string) => (e === "jane@example.com" ? [user()] : []));
    const r = await matchSsoUser({ email: "jane+x@example.com", email_verified: true }, { findUsersByEmail, now: () => new Date() });
    expect(r).toMatchObject({ ok: false, reason: "unknown_user" });
  });
});

describe("buildEndSessionUrl", () => {
  const cfg = ssoConfigFromEnv(FULL);
  it("returns null when SSO is disabled", () => {
    expect(buildEndSessionUrl(ssoConfigFromEnv({}), { postLogoutRedirectUri: "http://x/login" })).toBeNull();
  });
  it("builds a Keycloak logout URL with id_token_hint when available", () => {
    const u = new URL(buildEndSessionUrl(cfg, { idTokenHint: "tok", postLogoutRedirectUri: "https://crm.example.com/login" })!);
    expect(u.origin + u.pathname).toBe("https://id.example.com/realms/main/protocol/openid-connect/logout");
    expect(u.searchParams.get("id_token_hint")).toBe("tok");
    expect(u.searchParams.get("post_logout_redirect_uri")).toBe("https://crm.example.com/login");
    expect(u.searchParams.get("client_id")).toBeNull();
  });
  it("falls back to client_id when there is no id token", () => {
    const u = new URL(buildEndSessionUrl(cfg, { postLogoutRedirectUri: "https://crm.example.com/login" })!);
    expect(u.searchParams.get("client_id")).toBe("crm");
    expect(u.searchParams.get("id_token_hint")).toBeNull();
  });
});
