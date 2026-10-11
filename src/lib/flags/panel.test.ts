import { describe, expect, it } from "vitest";

import { buildFlagsPanel } from "./panel";
import { PROFILES, PROFILE_NAMES } from "./profiles";
import { REGISTRY, isFlagDef } from "./registry";
import { validateFlags } from "./validate";

const row = (data: ReturnType<typeof buildFlagsPanel>, name: string) => {
  const r = data.rows.find((x) => x.name === name);
  if (!r) throw new Error(`no row for ${name}`);
  return r;
};

describe("buildFlagsPanel: rows", () => {
  it("has one row per registered name, with its default, owner, dependencies and conflicts", () => {
    const data = buildFlagsPanel({});
    expect(data.rows.map((r) => r.name)).toEqual(REGISTRY.map((f) => f.name));
    const nudger = row(data, "AGENT_NUDGER_ENABLED");
    expect(nudger).toMatchObject({ kind: "outbound-ai", owner: "agents", default: "off", setAt: "run" });
    expect(nudger.dependsOn.join(" ")).toContain("CONSENT_ENFORCEMENT=1");
    expect(row(data, "DEMO_MODE").conflictsWith.join(" ")).toContain("CLEVERTAP_PUSH_ENABLED=1");
  });

  it("labels public flags as set at build, and server flags as run time", () => {
    const data = buildFlagsPanel({ NEXT_PUBLIC_C360: "1", PARTNER_WORKSPACE_ENABLED: "1" });
    expect(row(data, "NEXT_PUBLIC_C360")).toMatchObject({ setAt: "build", effective: { state: "on" } });
    expect(row(data, "PARTNER_WORKSPACE_ENABLED")).toMatchObject({ setAt: "run", effective: { state: "on" } });
    expect(row(data, "NEXT_PUBLIC_NAV_V2").effective.state).toBe("off");
  });

  it("calls a bool with a wrong value invalid (it reads as off), not on", () => {
    const data = buildFlagsPanel({ CONSENT_ENFORCEMENT: "true" });
    expect(row(data, "CONSENT_ENFORCEMENT").effective).toMatchObject({ state: "invalid" });
  });

  it("shows only presence for a credential and for an address or path, but the value of a safe setting", () => {
    const env = { ANTHROPIC_API_KEY: "sk-test-LEAKCHECK1", DATABASE_URL: "postgresql://u:LEAKPASS@db.example.com/x", REFERRAL_LINK_BASE: "https://leak.example.com/r", BACKOFFICE_IMPORT_DIR: "/srv/LEAKDIR", AI_PROVIDER: "openai", SOCIAL_TIMEZONE: "Asia/Dubai" };
    const data = buildFlagsPanel(env);
    expect(row(data, "ANTHROPIC_API_KEY").effective).toMatchObject({ state: "set" });
    expect(row(data, "DATABASE_URL").effective).toMatchObject({ state: "set" });
    expect(row(data, "OPENAI_API_KEY").effective).toMatchObject({ state: "not set" });
    expect(row(data, "REFERRAL_LINK_BASE").effective).toMatchObject({ state: "set" });
    expect(row(data, "AI_PROVIDER").effective).toMatchObject({ state: "value", value: "openai" });
    expect(row(data, "SOCIAL_TIMEZONE").effective).toMatchObject({ state: "value", value: "Asia/Dubai" });
    const text = JSON.stringify(data);
    for (const leak of ["LEAKCHECK1", "LEAKPASS", "leak.example.com", "LEAKDIR", "db.example.com"]) expect(text).not.toContain(leak);
  });

  it("shows the default for an unset setting", () => {
    const data = buildFlagsPanel({});
    expect(row(data, "AI_PROVIDER").effective).toMatchObject({ state: "default", value: "anthropic" });
    expect(row(data, "META_ADS_SYNC_EVERY_HOURS").effective).toMatchObject({ state: "default", value: "6" });
  });
});

describe("buildFlagsPanel: validation", () => {
  it("lists the validator's errors and warnings and attaches each to its flag", () => {
    const env = { AGENT_NUDGER_ENABLED: "1", NEXT_PUBLIC_OUTCOMES: "1" };
    const data = buildFlagsPanel(env);
    const direct = validateFlags(env);
    expect(data.summary.errors).toBe(direct.errors.length);
    expect(data.summary.warnings).toBe(direct.warnings.length);
    expect(data.findings.length).toBe(direct.errors.length + direct.warnings.length);
    expect(row(data, "AGENT_NUDGER_ENABLED").findings.some((f) => f.rule === "FR-10" && f.severity === "error")).toBe(true);
    expect(row(data, "NEXT_PUBLIC_OUTCOMES").findings.some((f) => f.rule === "FR-20")).toBe(true);
    for (const f of data.findings) {
      expect(f.fix.length).toBeGreaterThan(0);
    }
  });
  it("is quiet for a valid environment", () => {
    const data = buildFlagsPanel({ AUTH_SECRET: "x", CRON_SECRET: "x", ENCRYPTION_KEY: "x", NODE_ENV: "production", NEXT_PUBLIC_NAV_V2: "1" });
    expect(data.findings).toEqual([]);
  });
  it("summarises: how many switches exist, how many are on, how many are build-time", () => {
    const data = buildFlagsPanel({ NEXT_PUBLIC_NAV_V2: "1", PARTNER_WORKSPACE_ENABLED: "1", NEXT_PUBLIC_C360: "1" });
    expect(data.summary).toMatchObject({ registered: REGISTRY.length, switches: REGISTRY.filter(isFlagDef).length, on: 3, buildTimeOn: 2 });
  });
});

describe("buildFlagsPanel: profile comparison", () => {
  it("lists the five profiles, and an environment equal to a profile matches it exactly", () => {
    const data = buildFlagsPanel(PROFILES.pilot.values);
    expect(data.profiles.map((p) => p.name)).toEqual([...PROFILE_NAMES]);
    const pilot = data.profiles.find((p) => p.name === "pilot");
    expect(pilot).toMatchObject({ extraHere: [], missingHere: [] });
    expect(pilot?.matches).toBe(pilot?.total);
    expect(data.closestProfile).toBe("pilot");
  });
  it("lists what is on here but not in the profile, and what the profile turns on that is off here", () => {
    const data = buildFlagsPanel({ ...PROFILES.pilot.values, PARTNER_WORKSPACE_ENABLED: "1", NEXT_PUBLIC_SUPPORT_SLA: "0" });
    const pilot = data.profiles.find((p) => p.name === "pilot");
    expect(pilot?.extraHere).toEqual(["PARTNER_WORKSPACE_ENABLED"]);
    expect(pilot?.missingHere).toEqual(["NEXT_PUBLIC_SUPPORT_SLA"]);
  });
  it("shows flags that need approval as pending, not missing", () => {
    const data = buildFlagsPanel({});
    const live = data.profiles.find((p) => p.name === "go-live");
    expect(live?.missingHere).not.toContain("CLEVERTAP_PUSH_ENABLED");
    expect(live?.pendingApproval).toEqual(expect.arrayContaining(["CLEVERTAP_PUSH_ENABLED", "AGENT_NUDGER_ENABLED"]));
  });
  it("with nothing on, every profile reports its own flags as missing", () => {
    const data = buildFlagsPanel({});
    const demo = data.profiles.find((p) => p.name === "demo");
    expect(demo?.missingHere).toContain("NEXT_PUBLIC_C360");
    expect(demo?.extraHere).toEqual([]);
  });
});
