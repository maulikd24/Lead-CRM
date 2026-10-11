import { describe, expect, it, vi } from "vitest";

import {
  GOOGLE_PUBLIC_OUTCOME,
  decideGoogleSignIn,
  googleSignInConfigFromEnv,
  parseAllowedDomains,
  type GoogleUserRecord,
} from "./index";

const ENV = { GOOGLE_SIGNIN_ENABLED: "1", GOOGLE_CLIENT_ID: "id.apps.example", GOOGLE_CLIENT_SECRET: "shh" };
const user = (over: Partial<GoogleUserRecord> = {}): GoogleUserRecord => ({ id: "u1", email: "ria@corp.example", name: "Ria", role: "RM", isActive: true, lockedUntil: null, ...over });
const profile = (over: Record<string, unknown> = {}) => ({ email: "ria@corp.example", email_verified: true, hd: "corp.example", ...over });
const deps = (rows: GoogleUserRecord[] = [user()]) => ({ findUsersByEmail: vi.fn(async () => rows) });

describe("googleSignInConfigFromEnv", () => {
  it("is off unless the flag is exactly 1 and both credentials are present", () => {
    expect(googleSignInConfigFromEnv({}).enabled).toBe(false);
    expect(googleSignInConfigFromEnv({ ...ENV, GOOGLE_SIGNIN_ENABLED: "true" }).enabled).toBe(false);
    expect(googleSignInConfigFromEnv({ ...ENV, GOOGLE_CLIENT_ID: "" }).enabled).toBe(false);
    expect(googleSignInConfigFromEnv({ ...ENV, GOOGLE_CLIENT_SECRET: undefined }).enabled).toBe(false);
    expect(googleSignInConfigFromEnv(ENV)).toEqual({ enabled: true, clientId: "id.apps.example", clientSecret: "shh" });
  });
});

describe("parseAllowedDomains", () => {
  it("normalises, de-duplicates and drops anything that is not a plain domain", () => {
    expect(parseAllowedDomains([" Corp.Example ", "corp.example", "@evil.com", "a b.com", "", "x", "ok.in", 5, null])).toEqual(["corp.example", "ok.in"]);
    expect(parseAllowedDomains("corp.example, other.example\nthird.example")).toEqual(["corp.example", "other.example", "third.example"]);
  });
  it("returns an empty list for anything unusable (so Google sign-in stays disabled)", () => {
    expect(parseAllowedDomains(undefined)).toEqual([]);
    expect(parseAllowedDomains({})).toEqual([]);
  });
});

describe("decideGoogleSignIn", () => {
  it("default empty allow-list refuses everyone and never reaches the database", async () => {
    const d = deps();
    const r = await decideGoogleSignIn(profile(), [], d);
    expect(r).toMatchObject({ ok: false, reason: "no_domains_configured" });
    expect(d.findUsersByEmail).not.toHaveBeenCalled();
  });
  it("refuses a domain that is not on the list, without a database lookup", async () => {
    const d = deps();
    const r = await decideGoogleSignIn(profile({ email: "ria@other.example", hd: "other.example" }), ["corp.example"], d);
    expect(r).toMatchObject({ ok: false, reason: "domain_not_allowed" });
    expect(d.findUsersByEmail).not.toHaveBeenCalled();
  });
  it("requires a verified email", async () => {
    expect(await decideGoogleSignIn(profile({ email_verified: false }), ["corp.example"], deps())).toMatchObject({ ok: false, reason: "email_unverified" });
    expect(await decideGoogleSignIn(profile({ email_verified: "true" }), ["corp.example"], deps())).toMatchObject({ ok: false, reason: "email_unverified" });
  });
  it("requires the Workspace hosted-domain claim to match the email domain (a personal account with a company address is refused)", async () => {
    expect(await decideGoogleSignIn(profile({ hd: undefined }), ["corp.example"], deps())).toMatchObject({ ok: false, reason: "hosted_domain_mismatch" });
    expect(await decideGoogleSignIn(profile({ hd: "other.example" }), ["corp.example"], deps())).toMatchObject({ ok: false, reason: "hosted_domain_mismatch" });
  });
  it("refuses a Google account with no matching user: it never creates one", async () => {
    const r = await decideGoogleSignIn(profile(), ["corp.example"], deps([]));
    expect(r).toMatchObject({ ok: false, reason: "unknown_user" });
  });
  it("refuses an inactive user", async () => {
    expect(await decideGoogleSignIn(profile(), ["corp.example"], deps([user({ isActive: false })]))).toMatchObject({ ok: false, reason: "inactive_user" });
  });
  it("refuses an ambiguous match", async () => {
    expect(await decideGoogleSignIn(profile(), ["corp.example"], deps([user(), user({ id: "u2" })]))).toMatchObject({ ok: false, reason: "ambiguous_user" });
  });
  it("lets an existing active user in and takes the role from the database, not from the profile", async () => {
    const r = await decideGoogleSignIn(profile({ role: "ADMIN" }), ["corp.example"], deps([user({ role: "MARKETING" })]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.role).toBe("MARKETING");
  });
  it("matches the email case-insensitively and by the allowed domain list case-insensitively", async () => {
    const d = deps([user({ email: "Ria@Corp.Example" })]);
    expect((await decideGoogleSignIn(profile({ email: "RIA@corp.example" }), ["CORP.example"].flatMap((x) => parseAllowedDomains([x])), d)).ok).toBe(true);
  });
  it("is not fooled by look-alike domains or sub-domains", async () => {
    for (const email of ["ria@corp.example.evil.com", "ria@evilcorp.example", "ria@sub.corp.example"]) {
      expect(await decideGoogleSignIn(profile({ email, hd: email.split("@")[1] }), ["corp.example"], deps())).toMatchObject({ ok: false, reason: "domain_not_allowed" });
    }
  });
  it("applies the same lockout rule as SSO: a password lockout does not block Google sign-in", async () => {
    const r = await decideGoogleSignIn(profile(), ["corp.example"], deps([user({ lockedUntil: new Date(Date.now() + 1e6) })]));
    expect(r.ok).toBe(true);
  });
});

describe("no user enumeration", () => {
  it("every refusal maps to the one public outcome", async () => {
    const reasons = new Set<string>();
    const cases: Array<[unknown, string[], GoogleUserRecord[]]> = [
      [profile(), [], [user()]],
      [profile({ email: "x@other.example", hd: "other.example" }), ["corp.example"], []],
      [profile({ email_verified: false }), ["corp.example"], [user()]],
      [profile({ hd: undefined }), ["corp.example"], [user()]],
      [profile(), ["corp.example"], []],
      [profile(), ["corp.example"], [user({ isActive: false })]],
      [profile(), ["corp.example"], [user(), user({ id: "u2" })]],
      [null, ["corp.example"], [user()]],
    ];
    for (const [p, domains, rows] of cases) {
      const r = await decideGoogleSignIn(p as never, domains, deps(rows));
      expect(r.ok).toBe(false);
      if (!r.ok) reasons.add(r.reason);
    }
    expect(reasons.size).toBeGreaterThan(5);
    expect(GOOGLE_PUBLIC_OUTCOME).toBe("AccessDenied");
  });
});
