import { describe, expect, it } from "vitest";

import { byName, isRegistered, REGISTRY } from "./registry";
import { PROFILE_NAMES, PROFILES, credentialsNeeded, profileEnv, renderProfileEnv } from "./profiles";
import { validateFlags } from "./validate";

const merged = (name: (typeof PROFILE_NAMES)[number]) => ({ ...PROFILES[name].values, ...PROFILES[name].planned });
const isTrue = (env: Record<string, string>, n: string) => env[n] === "1";

describe("the five named profiles", () => {
  it("are demo, pilot, go-live, marketing-only and all-on", () => {
    expect([...PROFILE_NAMES]).toEqual(["demo", "pilot", "go-live", "marketing-only", "all-on"]);
  });

  it.each(PROFILE_NAMES.map((n) => [n]))("%s references only registered names, and in-flight names only under `planned`", (name) => {
    const p = PROFILES[name as (typeof PROFILE_NAMES)[number]];
    for (const n of [...Object.keys(p.values), ...Object.keys(p.planned), ...p.needsApproval]) expect(isRegistered(n), `${name}: ${n}`).toBe(true);
    for (const n of Object.keys(p.values)) expect(byName(n)?.inFlight, `${name}: ${n} is in flight and belongs under planned`).toBeUndefined();
    for (const n of Object.keys(p.planned)) expect(byName(n)?.inFlight, `${name}: ${n} exists in code already and belongs under values`).toBeTruthy();
    for (const n of p.needsApproval) expect(n in p.values || n in p.planned, `${name}: ${n} needs approval but is not in the profile`).toBe(true);
  });

  it.each(PROFILE_NAMES.map((n) => [n]))("%s validates with no error, today's flags and with the planned ones", (name) => {
    const n = name as (typeof PROFILE_NAMES)[number];
    for (const env of [PROFILES[n].values, merged(n)]) {
      const r = validateFlags(env, { context: "ci", profile: n, assumeCredentials: true });
      expect(r.errors.map((e) => `${e.rule} ${e.flag}: ${e.message}`)).toEqual([]);
    }
  });

  it("every profile value is plain: 1, 0 or a safe placeholder; no secret, no real host", () => {
    for (const name of PROFILE_NAMES) for (const [k, v] of Object.entries(merged(name))) {
      expect(byName(k)?.kind, `${name}: ${k}`).not.toBe("secret");
      expect(v, `${name}: ${k}`).not.toMatch(/sk-|postgres|password|secret|token/i);
      if (/^https?:/.test(v)) expect(v, `${name}: ${k}`).toMatch(/^https?:\/\/(example\.(com|org)|localhost|127\.0\.0\.1)/);
    }
  });

  it("all-on contains no blocked flag, no demo switch and no sample data, and turns on every feature flag that exists", () => {
    const all = merged("all-on");
    for (const f of REGISTRY.filter((x) => x.kind === "blocked")) expect(isTrue(all, f.name), f.name).toBe(false);
    for (const n of ["DEMO_MODE", "NEXT_PUBLIC_DEMO_MODE", "CLOSED_LOOP_DEMO", "PARTNER_ALLOW_SAMPLE", "SSO_ONLY", "EVALS_REAL_PROVIDER", "PUSH_DRY_RUN"]) expect(isTrue(all, n), n).toBe(false);
    expect(isTrue(all, "CONSENT_ENFORCEMENT")).toBe(true);
    const features = REGISTRY.filter((f) => f.kind === "feature" && f.type === "bool" && !["DEMO_MODE", "NEXT_PUBLIC_DEMO_MODE", "PARTNER_ALLOW_SAMPLE", "SSO_ONLY"].includes(f.name) && !f.name.startsWith("NEXT_PUBLIC_DEMO"));
    expect(features.filter((f) => !isTrue(all, f.name)).map((f) => f.name)).toEqual([]);
  });

  it("demo has no real outbound flag: an outbound flag is allowed only with its fake destination", () => {
    const demo = merged("demo");
    expect(isTrue(demo, "DEMO_MODE")).toBe(true);
    expect(isTrue(demo, "NEXT_PUBLIC_DEMO_MODE")).toBe(true);
    for (const f of REGISTRY.filter((x) => x.kind === "outbound" || x.kind === "outbound-ai" || x.kind === "blocked")) {
      if (!isTrue(demo, f.name)) continue;
      expect(f.demoStandIn && isTrue(demo, f.demoStandIn), `demo turns on ${f.name} without a fake destination`).toBe(true);
    }
    for (const n of ["CLEVERTAP_PUSH_ENABLED", "AGENT_NUDGER_ENABLED", "WA_ASSIST_AUTO", "AUTOPILOT_APPLY_ENABLED", "WA_ASSIST_ENABLED", "AI_AGENTS_ENABLED"]) expect(isTrue(demo, n), n).toBe(false);
  });

  it("go-live lists every [APPROVAL] flag as needing approval, and nothing else is left unmarked", () => {
    const live = PROFILES["go-live"];
    const inProfile = (n: string) => n in live.values || n in live.planned;
    const approvalFlags = REGISTRY.filter((f) => f.approval).map((f) => f.name);
    expect(approvalFlags.length).toBeGreaterThanOrEqual(3);
    for (const n of approvalFlags) {
      expect(live.needsApproval, n).toContain(n);
    }
    for (const n of live.needsApproval) expect(byName(n)?.approval, n).toBeTruthy();
    expect(["CLEVERTAP_PUSH_ENABLED", "AGENT_NUDGER_ENABLED"].every(inProfile)).toBe(true);
  });

  it("pilot is drafts only: no marketing, partner, referral or push", () => {
    const pilot = merged("pilot");
    for (const n of ["NEXT_PUBLIC_MARKETING", "PARTNER_WORKSPACE_ENABLED", "REFERRAL_PROGRAM_ENABLED", "CLEVERTAP_PUSH_ENABLED", "AGENT_NUDGER_ENABLED", "WA_ASSIST_AUTO"]) expect(isTrue(pilot, n), n).toBe(false);
    expect(isTrue(pilot, "CONSENT_ENFORCEMENT")).toBe(true);
    expect(isTrue(pilot, "WA_ASSIST_ENABLED")).toBe(true);
  });

  it("marketing-only turns on marketing surfaces and none of the customer-facing RM flags", () => {
    const m = merged("marketing-only");
    for (const n of ["NEXT_PUBLIC_MARKETING", "SOCIAL_DRAFTS_ENABLED", "NEXT_PUBLIC_CONSENT", "CONSENT_ENFORCEMENT"]) expect(isTrue(m, n), n).toBe(true);
    for (const n of ["NEXT_PUBLIC_NAV_V2", "NEXT_PUBLIC_HOME_V2", "NEXT_PUBLIC_C360", "NEXT_PUBLIC_OUTCOMES", "NEXT_PUBLIC_CALLS_REVIEW", "NEXT_PUBLIC_KANBAN", "AGENT_NUDGER_ENABLED", "WA_ASSIST_ENABLED", "CLEVERTAP_PUSH_ENABLED", "PARTNER_WORKSPACE_ENABLED"]) expect(isTrue(m, n), n).toBe(false);
  });

  it("an invalid variation of a profile is caught (the validator is wired to the profiles)", () => {
    const broken = { ...PROFILES["go-live"].values, CONSENT_ENFORCEMENT: "0" };
    const r = validateFlags(broken, { context: "ci", profile: "go-live", assumeCredentials: true });
    expect(r.errors.some((e) => e.rule === "FR-10")).toBe(true);
  });
});

describe("profile templates", () => {
  it.each(PROFILE_NAMES.map((n) => [n]))("%s renders names and safe values only, with approvals and credentials commented out", (name) => {
    const n = name as (typeof PROFILE_NAMES)[number];
    const text = renderProfileEnv(n);
    expect(text).toMatch(/^# Profile: /);
    expect(text).toContain("npm run flags:docs");
    for (const line of text.split("\n").filter((l) => l && !l.startsWith("#"))) {
      expect(line, line).toMatch(/^[A-Z][A-Z0-9_]+=\S*$/);
      const key = line.split("=")[0];
      expect(byName(key)?.kind, key).not.toBe("secret");
      expect(PROFILES[n].needsApproval, `${key} needs approval so it must be commented out`).not.toContain(key);
      expect(byName(key)?.inFlight, `${key} is in flight so it must be commented out`).toBeUndefined();
    }
    for (const a of PROFILES[n].needsApproval) expect(text).toMatch(new RegExp(`^# ${a}=`, "m"));
    expect(text).not.toMatch(/sk-|postgres:\/\/|BEGIN [A-Z ]*KEY/);
  });
  it("go-live names the credentials it needs, as empty commented placeholders", () => {
    const creds = credentialsNeeded("go-live");
    expect(creds).toEqual(expect.arrayContaining(["KEYCLOAK_CLIENT_SECRET", "PORTFOLIO_FEED_SECRET"]));
    const text = renderProfileEnv("go-live");
    for (const c of creds.filter((x) => /^[A-Z0-9_]+$/.test(x))) expect(text).toMatch(new RegExp(`^# ${c}=$`, "m"));
  });
  it("profileEnv merges values, and optionally the planned names", () => {
    expect(profileEnv("demo").DEMO_MODE).toBeUndefined();
    expect(profileEnv("demo", { includePlanned: true }).DEMO_MODE).toBe("1");
  });
});
