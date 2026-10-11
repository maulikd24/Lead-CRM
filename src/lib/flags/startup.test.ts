import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enforceFlagCheck, flagCheckEvent, resetFlagCheckForTests } from "./startup";

const PROD = { NODE_ENV: "production", VERCEL_ENV: "production", AUTH_SECRET: "x", CRON_SECRET: "x", ENCRYPTION_KEY: "x", DATABASE_URL: "postgresql://u:HUNTERPASS@db.example.com:5432/app" };
// outbound without consent enforcement: an FR-10 safety violation
const UNSAFE = { ...PROD, AGENT_NUDGER_ENABLED: "1", ANTHROPIC_API_KEY: "sk-test-KEYVALUE1234", NEXT_PUBLIC_CONSENT: "1" };

let logs: string[];
let warns: string[];
let errs: string[];
beforeEach(() => {
  resetFlagCheckForTests();
  logs = [];
  warns = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((m) => void logs.push(String(m)));
  vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));
  vi.spyOn(console, "error").mockImplementation((m) => void errs.push(String(m)));
});
afterEach(() => vi.restoreAllMocks());

const events = () => logs.concat(warns, errs).filter((l) => l.includes('"event":"flag_check"'));

describe("production start", () => {
  it("is silent when the environment is clean", () => {
    expect(() => enforceFlagCheck(PROD)).not.toThrow();
    expect(logs.concat(warns, errs)).toEqual([]);
  });

  it("aborts the boot on a safety-rule error, naming the rule and the flag but no value", () => {
    let message = "";
    try {
      enforceFlagCheck(UNSAFE);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("FR-10");
    expect(message).toContain("AGENT_NUDGER_ENABLED");
    expect(message).toContain("FLAG_CHECK=warn");
    for (const secret of ["HUNTERPASS", "KEYVALUE1234", "db.example.com"]) expect(message + logs.join() + errs.join()).not.toContain(secret);
  });

  it.each([
    ["FR-05 a blocked flag", { ...PROD, AUTOPILOT_APPLY_ENABLED: "1" }],
    ["FR-11 closed loop without consent", { ...PROD, CLOSED_LOOP_CONVERSIONS_ENABLED: "1", CLOSED_LOOP_DEMO: "1" }],
    ["FR-13 demo in production", { ...PROD, DEMO_MODE: "1", NEXT_PUBLIC_DEMO_MODE: "1" }],
    ["FR-14 sample partner data", { ...PROD, PARTNER_SOURCE: "sample" }],
    ["FR-10 outbound without consent", UNSAFE],
  ])("aborts on %s", (_name, env) => {
    expect(() => enforceFlagCheck(env)).toThrow(/flag check/i);
  });

  it("only warns with FLAG_CHECK=warn, logs loudly and records that the break-glass is in use", () => {
    expect(() => enforceFlagCheck({ ...UNSAFE, FLAG_CHECK: "warn" })).not.toThrow();
    const line = events()[0];
    expect(line).toBeTruthy();
    const event = JSON.parse(line);
    expect(event.breakGlass).toBe(true);
    expect(event.aborted).toBe(false);
    expect(event.errors.some((e: { rule: string }) => e.rule === "FR-10")).toBe(true);
    expect(errs.join("\n")).toMatch(/FLAG_CHECK=warn/);
  });

  it("never aborts for a non-safety finding: it logs one event with errors and warnings", () => {
    // FR-16 (no cron secret) is an error but not a safety rule; FR-02 ("true") is only a warning in production
    expect(() => enforceFlagCheck({ ...PROD, CRON_SECRET: "", NEXT_PUBLIC_C360: "true" })).not.toThrow();
    expect(events()).toHaveLength(1);
    const event = JSON.parse(events()[0]);
    expect(event.aborted).toBe(false);
    expect(event.errors.map((e: { rule: string }) => e.rule)).toContain("FR-16");
    expect(event.warnings.map((e: { rule: string }) => e.rule)).toContain("FR-02");
  });

  it("logs once however often it is called", () => {
    enforceFlagCheck({ ...PROD, CRON_SECRET: "" });
    enforceFlagCheck({ ...PROD, CRON_SECRET: "" });
    expect(events()).toHaveLength(1);
  });

  it("does not run during `next build`", () => {
    expect(() => enforceFlagCheck({ ...UNSAFE, NEXT_PHASE: "phase-production-build" })).not.toThrow();
    expect(logs.concat(warns, errs)).toEqual([]);
  });
});

describe("development start", () => {
  it("warns for everything and never aborts, even for a safety-rule error", () => {
    expect(() => enforceFlagCheck({ NODE_ENV: "development", AGENT_NUDGER_ENABLED: "1" })).not.toThrow();
    expect(warns.join("\n")).toContain("FR-10");
    expect(errs).toEqual([]);
  });
  it("is silent when nothing is wrong", () => {
    enforceFlagCheck({ NODE_ENV: "development", AUTH_SECRET: "x", CRON_SECRET: "x", ENCRYPTION_KEY: "x" });
    expect(logs.concat(warns, errs)).toEqual([]);
  });
});

describe("flagCheckEvent", () => {
  it("is plain data: rule, flag, message and fix, never a value", () => {
    const e = flagCheckEvent(UNSAFE, { aborted: true });
    expect(JSON.stringify(e)).not.toMatch(/HUNTERPASS|KEYVALUE|db\.example/);
    expect(e.event).toBe("flag_check");
    expect(e.errors[0]).toEqual(expect.objectContaining({ rule: expect.any(String), flag: expect.any(String), message: expect.any(String) }));
  });
});

describe("instrumentation register()", () => {
  it("runs the check on the node runtime and skips the edge runtime", async () => {
    const { register } = await import("../../instrumentation");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("AGENT_NUDGER_ENABLED", "1");
    await register();
    expect(warns).toEqual([]);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(warns.join("\n")).toContain("FR-10");
    vi.unstubAllEnvs();
  });
});
