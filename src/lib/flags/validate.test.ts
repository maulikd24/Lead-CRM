import { describe, expect, it } from "vitest";

import { FATAL_RULES, RULES, validateFlags, type ValidateOpts } from "./validate";
import type { RuleId } from "./types";

const CI: ValidateOpts = { context: "ci" };
const PROD: ValidateOpts = { context: "production" };
const DEV: ValidateOpts = { context: "development" };
/** Everything the outbound rules want, so a case can switch one thing off at a time. */
const CONSENT = { CONSENT_ENFORCEMENT: "1", NEXT_PUBLIC_CONSENT: "1" };
const AI = { ANTHROPIC_API_KEY: "sk-test-not-real" };
const PROD_BASE = { NODE_ENV: "production", VERCEL_ENV: "production", AUTH_SECRET: "x", CRON_SECRET: "x", ENCRYPTION_KEY: "x", DATABASE_URL: "postgresql://u:p@db.example.com:5432/app" };

const rules = (env: Record<string, string>, o: ValidateOpts = CI) => {
  const r = validateFlags(env, o);
  return { errors: r.errors.map((e) => e.rule), warnings: r.warnings.map((w) => w.rule), all: r };
};

describe("rule list", () => {
  it("has the 15 stable rule ids", () => {
    expect(RULES.map((r) => r.id)).toEqual(["FR-01", "FR-02", "FR-03", "FR-04", "FR-05", "FR-10", "FR-11", "FR-12", "FR-13", "FR-14", "FR-15", "FR-16", "FR-20", "FR-30", "FR-31"]);
  });
  it("aborts production boot only for the safety rules", () => {
    expect([...FATAL_RULES].sort()).toEqual(["FR-05", "FR-10", "FR-11", "FR-13", "FR-14"]);
  });
});

describe("a clean environment", () => {
  it("has no findings with nothing set", () => {
    const r = validateFlags({}, CI);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it("is clean in production with the always-required secrets and a hosted database", () => {
    const r = validateFlags(PROD_BASE, PROD);
    expect(r.errors).toEqual([]);
  });
});

type Case = { rule: RuleId; name: string; env: Record<string, string>; opts?: ValidateOpts; severity: "error" | "warn"; flag?: string };
type Clean = { rule: RuleId; name: string; env: Record<string, string>; opts?: ValidateOpts };

const POSITIVE: Case[] = [
  // FR-01 unknown NEXT_PUBLIC_ name
  { rule: "FR-01", name: "unknown public name", env: { NEXT_PUBLIC_NOT_A_FLAG: "1" }, severity: "error", flag: "NEXT_PUBLIC_NOT_A_FLAG" },
  // FR-02 bad value
  { rule: "FR-02", name: "true instead of 1 (ci: error)", env: { CONSENT_ENFORCEMENT: "true" }, severity: "error", flag: "CONSENT_ENFORCEMENT" },
  { rule: "FR-02", name: "true instead of 1 (production: warn)", env: { ...PROD_BASE, CONSENT_ENFORCEMENT: "true" }, opts: PROD, severity: "warn", flag: "CONSENT_ENFORCEMENT" },
  { rule: "FR-02", name: "yes", env: { NEXT_PUBLIC_MARKETING: "yes" }, severity: "error", flag: "NEXT_PUBLIC_MARKETING" },
  { rule: "FR-02", name: "on", env: { PARTNER_WORKSPACE_ENABLED: "on" }, severity: "error" },
  { rule: "FR-02", name: "leading space", env: { SSO_ENABLED: " 1" }, severity: "error" },
  { rule: "FR-02", name: "bad enum", env: { AI_PROVIDER: "gemini" }, severity: "error", flag: "AI_PROVIDER" },
  { rule: "FR-02", name: "int not a number", env: { META_ADS_SYNC_EVERY_HOURS: "often" }, severity: "error", flag: "META_ADS_SYNC_EVERY_HOURS" },
  { rule: "FR-02", name: "int below its minimum", env: { META_ADS_SYNC_EVERY_HOURS: "0" }, severity: "error" },
  { rule: "FR-02", name: "url that is not a url", env: { REFERRAL_LINK_BASE: "not a url" }, severity: "error", flag: "REFERRAL_LINK_BASE" },
  // FR-03 requires
  { rule: "FR-03", name: "auto-draft without the reply assistant", env: { WA_ASSIST_AUTO: "1", ...CONSENT, ...AI }, severity: "error", flag: "WA_ASSIST_AUTO" },
  { rule: "FR-03", name: "outcome drafts without the outcomes screens", env: { OUTCOMES_DRAFTS_ENABLED: "1", ...CONSENT, ...AI }, severity: "error", flag: "OUTCOMES_DRAFTS_ENABLED" },
  { rule: "FR-03", name: "sample allowance without the sample source", env: { PARTNER_ALLOW_SAMPLE: "1" }, severity: "error", flag: "PARTNER_ALLOW_SAMPLE" },
  // FR-04 conflicts
  { rule: "FR-04", name: "real judge in CI", env: { EVALS_REAL_PROVIDER: "1", CI: "1", ...AI }, severity: "error", flag: "EVALS_REAL_PROVIDER" },
  { rule: "FR-04", name: "opt-in database test against a hosted database", env: { ACCESS_DB_TEST: "1", DATABASE_URL: "postgresql://u:p@db.example.com:5432/app" }, severity: "error", flag: "ACCESS_DB_TEST" },
  { rule: "FR-04", name: "push dry run in production (warn)", env: { ...PROD_BASE, PUSH_DRY_RUN: "1" }, opts: PROD, severity: "warn", flag: "PUSH_DRY_RUN" },
  // FR-05 blocked
  { rule: "FR-05", name: "autonomous ad changes", env: { AUTOPILOT_APPLY_ENABLED: "1" }, severity: "error", flag: "AUTOPILOT_APPLY_ENABLED" },
  { rule: "FR-05", name: "blocked in production too", env: { ...PROD_BASE, AUTOPILOT_APPLY_ENABLED: "1" }, opts: PROD, severity: "error" },
  { rule: "FR-05", name: "blocked in development too", env: { AUTOPILOT_APPLY_ENABLED: "1" }, opts: DEV, severity: "error" },
  // FR-10 outbound needs consent enforcement and the ledger
  { rule: "FR-10", name: "nudger without consent enforcement", env: { AGENT_NUDGER_ENABLED: "1", NEXT_PUBLIC_CONSENT: "1", ...AI }, severity: "error", flag: "AGENT_NUDGER_ENABLED" },
  { rule: "FR-10", name: "nudger without the consent screens", env: { AGENT_NUDGER_ENABLED: "1", CONSENT_ENFORCEMENT: "1", ...AI }, severity: "error" },
  { rule: "FR-10", name: "CleverTap push without consent enforcement", env: { CLEVERTAP_PUSH_ENABLED: "1", NEXT_PUBLIC_CONSENT: "1" }, severity: "error", flag: "CLEVERTAP_PUSH_ENABLED" },
  { rule: "FR-10", name: "reply assistant without consent enforcement", env: { WA_ASSIST_ENABLED: "1", NEXT_PUBLIC_CONSENT: "1", ...AI }, severity: "error" },
  { rule: "FR-10", name: "AI next actions without consent enforcement", env: { AI_AGENTS_ENABLED: "1", NEXT_PUBLIC_CONSENT: "1", AGENT_API_KEY: "k", ...AI }, severity: "error", flag: "AI_AGENTS_ENABLED" },
  // FR-11 closed loop chain
  { rule: "FR-11", name: "closed loop without consent enforcement", env: { CLOSED_LOOP_CONVERSIONS_ENABLED: "1", NEXT_PUBLIC_CONSENT: "1", CLOSED_LOOP_DEMO: "1" }, severity: "error", flag: "CLOSED_LOOP_CONVERSIONS_ENABLED" },
  { rule: "FR-11", name: "closed loop with ADS_MEASUREMENT record-only", env: { CLOSED_LOOP_CONVERSIONS_ENABLED: "1", ...CONSENT, CLOSED_LOOP_DEMO: "1", CONSENT_RECORD_ONLY_PURPOSES: "ADS_MEASUREMENT" }, severity: "error" },
  { rule: "FR-11", name: "record-only list is case-insensitive and may hold several", env: { CLOSED_LOOP_CONVERSIONS_ENABLED: "1", ...CONSENT, CLOSED_LOOP_DEMO: "1", CONSENT_RECORD_ONLY_PURPOSES: "marketing, ads_measurement" }, severity: "error" },
  { rule: "FR-11", name: "closed loop without the consent screens", env: { CLOSED_LOOP_CONVERSIONS_ENABLED: "1", CONSENT_ENFORCEMENT: "1", CLOSED_LOOP_DEMO: "1" }, severity: "error" },
  // FR-12 AI needs a key (error) and a recorded sign-off (warning: the database is not read here)
  { rule: "FR-12", name: "reply assistant with no provider key", env: { WA_ASSIST_ENABLED: "1", ...CONSENT }, severity: "error", flag: "WA_ASSIST_ENABLED" },
  { rule: "FR-12", name: "key for the other provider does not count", env: { WA_ASSIST_ENABLED: "1", ...CONSENT, AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "k" }, severity: "error" },
  { rule: "FR-12", name: "recorded sign-off cannot be checked from env", env: { WA_ASSIST_ENABLED: "1", ...CONSENT, ...AI }, severity: "warn", flag: "WA_ASSIST_ENABLED" },
  { rule: "FR-12", name: "creative intelligence AI path with no key", env: { NEXT_PUBLIC_CREATIVE_INTEL: "1", NEXT_PUBLIC_MARKETING: "1" }, severity: "error", flag: "NEXT_PUBLIC_CREATIVE_INTEL" },
  // FR-13 demo
  { rule: "FR-13", name: "demo with live CleverTap writes", env: { DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1", CLEVERTAP_PUSH_ENABLED: "1", ...CONSENT }, severity: "error", flag: "DEMO_MODE" },
  { rule: "FR-13", name: "demo with the nudger", env: { DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1", AGENT_NUDGER_ENABLED: "1", ...CONSENT }, severity: "error" },
  { rule: "FR-13", name: "demo with reply auto-draft", env: { DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1", WA_ASSIST_ENABLED: "1", WA_ASSIST_AUTO: "1", ...CONSENT }, severity: "error" },
  { rule: "FR-13", name: "demo in a production environment", env: { DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1", VERCEL_ENV: "production" }, severity: "error" },
  { rule: "FR-13", name: "demo against a hosted database", env: { DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1", DATABASE_URL: "postgresql://u:p@db.example.com/app" }, severity: "error" },
  { rule: "FR-13", name: "closed loop under demo without the fake destination", env: { DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1", CLOSED_LOOP_CONVERSIONS_ENABLED: "1", ...CONSENT }, severity: "error" },
  { rule: "FR-13", name: "build-time twin differs from DEMO_MODE", env: { DEMO_MODE: "1" }, severity: "error", flag: "DEMO_MODE" },
  { rule: "FR-13", name: "build-time twin set without DEMO_MODE", env: { NEXT_PUBLIC_DEMO_MODE: "1" }, severity: "error", flag: "NEXT_PUBLIC_DEMO_MODE" },
  // FR-14 sample partner data
  { rule: "FR-14", name: "sample allowance in production", env: { ...PROD_BASE, PARTNER_ALLOW_SAMPLE: "1", PARTNER_SOURCE: "sample" }, opts: PROD, severity: "error", flag: "PARTNER_ALLOW_SAMPLE" },
  { rule: "FR-14", name: "sample source in production", env: { ...PROD_BASE, PARTNER_SOURCE: "sample" }, opts: PROD, severity: "error", flag: "PARTNER_SOURCE" },
  // FR-15 auth
  { rule: "FR-15", name: "SSO only without SSO", env: { SSO_ONLY: "1", SSO_BREAK_GLASS_EMAILS: "a@example.com" }, severity: "error", flag: "SSO_ONLY" },
  { rule: "FR-15", name: "SSO only without a break-glass list", env: { SSO_ONLY: "1", SSO_ENABLED: "1", KEYCLOAK_ISSUER: "https://id.example.com", KEYCLOAK_CLIENT_ID: "c", KEYCLOAK_CLIENT_SECRET: "s" }, severity: "error", flag: "SSO_ONLY" },
  { rule: "FR-15", name: "SSO without its three settings", env: { SSO_ENABLED: "1", KEYCLOAK_ISSUER: "https://id.example.com" }, severity: "error", flag: "SSO_ENABLED" },
  // FR-16 secret pairing
  { rule: "FR-16", name: "portfolio feed without its secret", env: { PORTFOLIO_FEED_ENABLED: "1" }, severity: "error", flag: "PORTFOLIO_FEED_ENABLED" },
  { rule: "FR-16", name: "referral programme without a link base", env: { REFERRAL_PROGRAM_ENABLED: "1", APP_SIGNUP_SECRET: "s" }, severity: "error", flag: "REFERRAL_PROGRAM_ENABLED" },
  { rule: "FR-16", name: "referral programme without the signup secret", env: { REFERRAL_PROGRAM_ENABLED: "1", REFERRAL_LINK_BASE: "https://example.com/r" }, severity: "error" },
  { rule: "FR-16", name: "app user id matching without the signup secret", env: { APP_USER_ID_LINKING: "1" }, severity: "error", flag: "APP_USER_ID_LINKING" },
  { rule: "FR-16", name: "back-office import without a drop folder", env: { BACKOFFICE_IMPORT_ENABLED: "1" }, severity: "error", flag: "BACKOFFICE_IMPORT_ENABLED" },
  { rule: "FR-16", name: "production without the cron secret", env: { ...PROD_BASE, CRON_SECRET: "" }, opts: PROD, severity: "error", flag: "CRON_SECRET" },
  { rule: "FR-16", name: "production without an auth secret (either name satisfies)", env: { ...PROD_BASE, AUTH_SECRET: "" }, opts: PROD, severity: "error", flag: "AUTH_SECRET" },
  { rule: "FR-16", name: "production without the encryption key", env: { ...PROD_BASE, ENCRYPTION_KEY: "" }, opts: PROD, severity: "error", flag: "ENCRYPTION_KEY" },
  // FR-20 soft prerequisites
  { rule: "FR-20", name: "attribution without Customer 360", env: { NEXT_PUBLIC_ATTRIBUTION: "1", NEXT_PUBLIC_MARKETING: "1" }, severity: "warn", flag: "NEXT_PUBLIC_ATTRIBUTION" },
  { rule: "FR-20", name: "outcomes without Customer 360", env: { NEXT_PUBLIC_OUTCOMES: "1" }, severity: "warn", flag: "NEXT_PUBLIC_OUTCOMES" },
  { rule: "FR-20", name: "duplicate review without the suggestion job (empty queue)", env: { NEXT_PUBLIC_MERGE_REVIEW: "1" }, severity: "warn", flag: "NEXT_PUBLIC_MERGE_REVIEW" },
  { rule: "FR-20", name: "creative intelligence without marketing", env: { NEXT_PUBLIC_CREATIVE_INTEL: "1", ...AI }, severity: "warn", flag: "NEXT_PUBLIC_CREATIVE_INTEL" },
  { rule: "FR-20", name: "planner without marketing (warn outside profiles)", env: { NEXT_PUBLIC_PLANNER: "1" }, severity: "warn", flag: "NEXT_PUBLIC_PLANNER", opts: PROD },
  { rule: "FR-20", name: "planner without marketing (error in a profile)", env: { NEXT_PUBLIC_PLANNER: "1" }, severity: "error", opts: { ...CI, profile: "all-on" } },
  { rule: "FR-20", name: "autopilot without marketing (error in a profile)", env: { NEXT_PUBLIC_AUTOPILOT: "1", META_ADS_SYNC_ENABLED: "1" }, severity: "error", opts: { ...CI, profile: "all-on" }, flag: "NEXT_PUBLIC_AUTOPILOT" },
  { rule: "FR-20", name: "social drafts without marketing (error in a profile)", env: { SOCIAL_DRAFTS_ENABLED: "1" }, severity: "error", opts: { ...CI, profile: "pilot" }, flag: "SOCIAL_DRAFTS_ENABLED" },
  { rule: "FR-20", name: "director reports without marketing (error in a profile)", env: { DIRECTOR_REPORTS_ENABLED: "1" }, severity: "error", opts: { ...CI, profile: "pilot" }, flag: "DIRECTOR_REPORTS_ENABLED" },
  { rule: "FR-20", name: "autopilot without an ad data source", env: { NEXT_PUBLIC_AUTOPILOT: "1", NEXT_PUBLIC_MARKETING: "1" }, severity: "warn", flag: "NEXT_PUBLIC_AUTOPILOT" },
  // FR-30 rebuild pending
  { rule: "FR-30", name: "public flag differs from what the bundle was built with", env: { NEXT_PUBLIC_MARKETING: "1" }, opts: { ...CI, buildFlags: {} }, severity: "warn", flag: "NEXT_PUBLIC_MARKETING" },
  { rule: "FR-30", name: "flag built on but now unset", env: {}, opts: { ...CI, buildFlags: { NEXT_PUBLIC_C360: "1" } }, severity: "warn", flag: "NEXT_PUBLIC_C360" },
];

const NEGATIVE: Clean[] = [
  { rule: "FR-01", name: "a registered public name", env: { NEXT_PUBLIC_NAV_V2: "1" } },
  { rule: "FR-02", name: "exactly 1", env: { CONSENT_ENFORCEMENT: "1" } },
  { rule: "FR-02", name: "empty is unset", env: { CONSENT_ENFORCEMENT: "" } },
  { rule: "FR-02", name: "0 is an explicit off", env: { CONSENT_ENFORCEMENT: "0" } },
  { rule: "FR-02", name: "valid enum, int and url", env: { AI_PROVIDER: "openai", META_ADS_SYNC_EVERY_HOURS: "12", REFERRAL_LINK_BASE: "https://example.com/r" } },
  { rule: "FR-03", name: "auto-draft with the assistant", env: { WA_ASSIST_ENABLED: "1", WA_ASSIST_AUTO: "1", ...CONSENT, ...AI } },
  { rule: "FR-03", name: "sample allowance with the sample source outside production", env: { PARTNER_ALLOW_SAMPLE: "1", PARTNER_SOURCE: "sample" } },
  { rule: "FR-04", name: "real judge outside CI", env: { EVALS_REAL_PROVIDER: "1", ...AI } },
  { rule: "FR-04", name: "opt-in database test against localhost", env: { ACCESS_DB_TEST: "1", DATABASE_URL: "postgresql://u:p@127.0.0.1:55432/wt_flags_x" } },
  { rule: "FR-05", name: "blocked flag off", env: { AUTOPILOT_APPLY_ENABLED: "0" } },
  { rule: "FR-10", name: "nudger with consent enforcement and the ledger", env: { AGENT_NUDGER_ENABLED: "1", ...CONSENT, ...AI } },
  { rule: "FR-10", name: "no outbound flag, no consent needed", env: { NEXT_PUBLIC_MARKETING: "1" } },
  { rule: "FR-11", name: "closed loop with the full chain and the fake destination", env: { CLOSED_LOOP_CONVERSIONS_ENABLED: "1", ...CONSENT, CLOSED_LOOP_DEMO: "1" } },
  { rule: "FR-11", name: "other purposes may be record-only", env: { CLOSED_LOOP_CONVERSIONS_ENABLED: "1", ...CONSENT, CLOSED_LOOP_DEMO: "1", CONSENT_RECORD_ONLY_PURPOSES: "MARKETING" } },
  { rule: "FR-11", name: "the kill switch is always allowed", env: { CLOSED_LOOP_KILL_SWITCH: "1" } },
  { rule: "FR-12", name: "key for the chosen provider", env: { WA_ASSIST_ENABLED: "1", ...CONSENT, AI_PROVIDER: "openai", OPENAI_API_KEY: "k" } },
  { rule: "FR-12", name: "demo stand-in needs no key", env: { WA_ASSIST_ENABLED: "1", ...CONSENT, DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1" } },
  { rule: "FR-12", name: "assumeCredentials", env: { WA_ASSIST_ENABLED: "1", ...CONSENT }, opts: { ...CI, assumeCredentials: true } },
  { rule: "FR-13", name: "demo with every real outbound off", env: { DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1", DATABASE_URL: "postgresql://u:p@localhost:5432/demo" } },
  { rule: "FR-13", name: "demo with a local IPv6 database", env: { DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1", DATABASE_URL: "postgresql://u:p@[::1]:5432/demo" } },
  { rule: "FR-13", name: "closed loop under demo with the fake destination", env: { DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1", CLOSED_LOOP_CONVERSIONS_ENABLED: "1", CLOSED_LOOP_DEMO: "1", ...CONSENT } },
  { rule: "FR-14", name: "sample source outside production", env: { PARTNER_SOURCE: "sample" } },
  { rule: "FR-14", name: "native source in production", env: { ...PROD_BASE, PARTNER_SOURCE: "native" }, opts: PROD },
  { rule: "FR-15", name: "SSO only with SSO, three settings and a break-glass list", env: { SSO_ONLY: "1", SSO_ENABLED: "1", SSO_BREAK_GLASS_EMAILS: "a@example.com", KEYCLOAK_ISSUER: "https://id.example.com", KEYCLOAK_CLIENT_ID: "c", KEYCLOAK_CLIENT_SECRET: "s" } },
  { rule: "FR-16", name: "portfolio feed with its secret", env: { PORTFOLIO_FEED_ENABLED: "1", PORTFOLIO_FEED_SECRET: "s" } },
  { rule: "FR-16", name: "referral programme with both", env: { REFERRAL_PROGRAM_ENABLED: "1", REFERRAL_LINK_BASE: "https://example.com/r", APP_SIGNUP_SECRET: "s" } },
  { rule: "FR-16", name: "always-required secrets are not needed in CI", env: {} },
  { rule: "FR-16", name: "NEXTAUTH_SECRET satisfies the auth secret", env: { ...PROD_BASE, AUTH_SECRET: "", NEXTAUTH_SECRET: "x" }, opts: PROD },
  { rule: "FR-20", name: "attribution with Customer 360 and marketing", env: { NEXT_PUBLIC_ATTRIBUTION: "1", NEXT_PUBLIC_C360: "1", NEXT_PUBLIC_MARKETING: "1" } },
  { rule: "FR-20", name: "merge review with the suggestion job", env: { NEXT_PUBLIC_MERGE_REVIEW: "1", MERGE_SUGGESTIONS_ENABLED: "1" } },
  { rule: "FR-20", name: "autopilot with marketing and a sync flag", env: { NEXT_PUBLIC_AUTOPILOT: "1", NEXT_PUBLIC_MARKETING: "1", GOOGLE_ADS_REPORTING_ENABLED: "1" } },
  { rule: "FR-30", name: "built and running agree", env: { NEXT_PUBLIC_C360: "1" }, opts: { ...CI, buildFlags: { NEXT_PUBLIC_C360: "1" } } },
  { rule: "FR-30", name: "no build record, no comparison", env: { NEXT_PUBLIC_C360: "1" } },
];

describe("each rule fires on a bad combination", () => {
  it.each(POSITIVE.map((c) => [c.rule, c.name, c] as const))("%s: %s", (_r, _n, c) => {
    const result = validateFlags(c.env, c.opts ?? CI);
    const list = c.severity === "error" ? result.errors : result.warnings;
    const hits = list.filter((v) => v.rule === c.rule && (!c.flag || v.flag === c.flag));
    expect(hits.length, JSON.stringify({ errors: result.errors.map((e) => `${e.rule}:${e.flag}`), warnings: result.warnings.map((e) => `${e.rule}:${e.flag}`) })).toBeGreaterThan(0);
    for (const v of hits) {
      expect(v.message.length).toBeGreaterThan(10);
      expect(v.fix.length).toBeGreaterThan(5);
    }
  });
});

describe("each rule stays quiet on a good combination", () => {
  it.each(NEGATIVE.map((c) => [c.rule, c.name, c] as const))("%s: %s", (_r, _n, c) => {
    const result = validateFlags(c.env, c.opts ?? CI);
    // FR-12 also raises an informational warning (the sign-off cannot be read from env); only its errors count as a failure here.
    const hit = [...result.errors, ...(c.rule === "FR-12" ? [] : result.warnings)].filter((v) => v.rule === c.rule);
    expect(hit.map((v) => `${v.rule}:${v.flag}:${v.message}`)).toEqual([]);
  });
});

describe("coverage of the table", () => {
  it("has a positive and a negative case for every rule that the pure function owns, and FR-31 is covered by the source scan", () => {
    const pure = RULES.map((r) => r.id).filter((id) => id !== "FR-31");
    for (const id of pure) {
      expect(POSITIVE.some((c) => c.rule === id), `positive ${id}`).toBe(true);
      expect(NEGATIVE.some((c) => c.rule === id), `negative ${id}`).toBe(true);
    }
  });
});

describe("severity by context", () => {
  it("a wrong bool value is an error in CI and a warning in production (a typo must not stop a boot)", () => {
    expect(rules({ NEXT_PUBLIC_C360: "true" }, CI).errors).toContain("FR-02");
    const prod = rules({ ...PROD_BASE, NEXT_PUBLIC_C360: "true" }, PROD);
    expect(prod.errors).not.toContain("FR-02");
    expect(prod.warnings).toContain("FR-02");
  });
  it("always-required secrets are skipped in CI, an error in production and reported in development", () => {
    expect(rules({}, CI).errors).toEqual([]);
    expect(rules({ NODE_ENV: "production" }, PROD).errors.filter((r) => r === "FR-16").length).toBeGreaterThanOrEqual(3);
    expect(rules({}, DEV).errors.filter((r) => r === "FR-16").length).toBeGreaterThanOrEqual(3);
  });
  it("the context is derived from NODE_ENV and CI when not given", () => {
    expect(validateFlags({ NODE_ENV: "production" }).errors.some((e) => e.rule === "FR-16")).toBe(true);
    expect(validateFlags({ CI: "1" }).errors).toEqual([]);
  });
});

describe("assumeCredentials", () => {
  it("treats credentials as present but not plain config", () => {
    const env = { SSO_ENABLED: "1", PORTFOLIO_FEED_ENABLED: "1", REFERRAL_PROGRAM_ENABLED: "1" };
    const without = rules(env, CI);
    expect(without.errors).toContain("FR-15");
    const withCreds = rules(env, { ...CI, assumeCredentials: true });
    expect(withCreds.errors).not.toContain("FR-15");
    // the referral link base is plain config, not a credential: still required
    expect(withCreds.all.errors.some((e) => e.flag === "REFERRAL_PROGRAM_ENABLED" && /link/i.test(e.message))).toBe(true);
  });
});

describe("output never carries a value", () => {
  it("names flags and gives instructions, but never an env value", () => {
    const env = { AGENT_NUDGER_ENABLED: "1", ANTHROPIC_API_KEY: "sk-live-SECRETVALUE-123", DATABASE_URL: "postgresql://admin:HUNTER2PASS@db.example.com:5432/app", SSO_ENABLED: "1", KEYCLOAK_CLIENT_SECRET: "KC-SECRETVALUE-456", NEXT_PUBLIC_NOPE: "SOMEVALUE-789" };
    const text = JSON.stringify(validateFlags(env, CI));
    for (const secret of ["SECRETVALUE", "HUNTER2PASS", "SOMEVALUE-789", "admin:"]) expect(text).not.toContain(secret);
  });
});

describe("a combination of several mistakes reports each of them", () => {
  it("lists the outbound, AI and demo problems together", () => {
    const r = validateFlags({ DEMO_MODE: "1", CLEVERTAP_PUSH_ENABLED: "1", WA_ASSIST_ENABLED: "1" }, CI);
    const ids = new Set(r.errors.map((e) => e.rule));
    for (const id of ["FR-10", "FR-13"]) expect(ids.has(id as RuleId), id).toBe(true);
  });
});
