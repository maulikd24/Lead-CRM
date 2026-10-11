import { evalCond, isOn, type CondOpts, type Env } from "./cond";
import { REGISTRY, byName, isRegistered } from "./registry";
import type { Context, FlagDef, Requirement, RuleId, Violation } from "./types";

/**
 * validateFlags: a pure function over an environment object. It reads no file, no database and no process state, so the
 * same call serves the startup check, the CI check, the profile tests and the Admin Flags tab.
 *
 * Output never contains an environment VALUE: names, rule ids and instructions only (a value can be a secret).
 */

export interface RuleInfo {
  id: RuleId;
  severity: "error" | "warn";
  title: string;
  /** Where the rule is checked: "validate" (this function), "scan" (needs the source tree) or "build" (needs the build record). */
  where: "validate" | "scan" | "build";
}

export const RULES: readonly RuleInfo[] = [
  { id: "FR-01", severity: "error", title: "Unknown name: a NEXT_PUBLIC_* name, or a name read in the source, that is not in the registry", where: "validate" },
  { id: "FR-02", severity: "error", title: "Bad value: a bool that is not 1 (true, yes and on are silently off), or an enum, int or url that does not parse", where: "validate" },
  { id: "FR-03", severity: "error", title: "A requirement of the flag is not satisfied", where: "validate" },
  { id: "FR-04", severity: "error", title: "A conflict of the flag is present", where: "validate" },
  { id: "FR-05", severity: "error", title: "A blocked flag is on (autonomous ad-spend changes)", where: "validate" },
  { id: "FR-10", severity: "error", title: "Outbound or vendor-sharing needs consent enforcement and the consent screens", where: "validate" },
  { id: "FR-11", severity: "error", title: "Closed-loop conversions need the full consent chain and may not be record-only for ads measurement", where: "validate" },
  { id: "FR-12", severity: "error", title: "AI features need a provider key (error) and a recorded sign-off (warning: not readable from env)", where: "validate" },
  { id: "FR-13", severity: "error", title: "No live outbound, production or hosted database under demo; the build-time twin must match", where: "validate" },
  { id: "FR-14", severity: "error", title: "Sample partner data conflicts with a production environment", where: "validate" },
  { id: "FR-15", severity: "error", title: "Single sign-on pairing: SSO_ONLY needs SSO and a break-glass list; SSO needs its three settings", where: "validate" },
  { id: "FR-16", severity: "error", title: "Secret and setting pairing, and the always-required secrets", where: "validate" },
  { id: "FR-20", severity: "warn", title: "Soft prerequisite: a screen that renders empty or unreachable without another flag (an error in profiles for the marketing-gated four)", where: "validate" },
  { id: "FR-30", severity: "warn", title: "Build-time mismatch: a NEXT_PUBLIC_* value differs from what the running bundle was built with (a rebuild is pending)", where: "build" },
  { id: "FR-31", severity: "warn", title: "Deprecated or unreferenced registered flag: registered, but nothing in the source reads it", where: "scan" },
];

/** The safety rules: in production an error from one of these stops the boot. Everything else is logged. */
export const FATAL_RULES: ReadonlySet<RuleId> = new Set<RuleId>(["FR-05", "FR-10", "FR-11", "FR-13", "FR-14"]);

export interface ValidateOpts {
  /** Where the check runs. Derived from the environment when omitted: CI set -> ci, NODE_ENV production -> production, else development. */
  context?: Context;
  /** A named profile is being validated: strict. */
  profile?: string;
  /** Treat warnings that "escalate in profiles" as errors, and a wrong bool value as an error. Default: true in ci and for a profile. */
  strict?: boolean;
  /** Treat every credential (and the AI provider key) as present. Profiles are validated this way: CI has no keys. */
  assumeCredentials?: boolean;
  /** The NEXT_PUBLIC_* values the running bundle was built with (build-flags.json); enables FR-30. */
  buildFlags?: Record<string, string | undefined>;
}

export function deriveContext(env: Env): Context {
  if (env.CI && env.CI.trim() !== "") return "ci";
  return env.NODE_ENV === "production" ? "production" : "development";
}

const present = (env: Env, n: string) => typeof env[n] === "string" && (env[n] as string).trim() !== "";

/** Why a value does not parse, or null. Never repeats the value. */
export function valueProblem(def: FlagDef, raw: string): string | null {
  switch (def.type) {
    case "bool":
      return raw === "1" || raw === "0" ? null : `${def.name} is set to something other than 1. Only the exact value 1 turns it on; true, yes and on are silently treated as off.`;
    case "enum":
      return def.options?.includes(raw) ? null : `${def.name} is not one of: ${(def.options ?? []).join(", ")}.`;
    case "int": {
      if (!/^\d+$/.test(raw)) return `${def.name} must be a whole number.`;
      const n = Number(raw);
      if (def.min !== undefined && n < def.min) return `${def.name} is below its minimum of ${def.min}.`;
      if (def.max !== undefined && n > def.max) return `${def.name} is above its maximum of ${def.max}.`;
      return null;
    }
    case "url":
      try {
        const u = new URL(raw);
        return u.protocol === "https:" || u.protocol === "http:" ? null : `${def.name} must be an http or https address.`;
      } catch {
        return `${def.name} is not a valid address.`;
      }
    default:
      return null;
  }
}

export function validateFlags(env: Env, opts: ValidateOpts = {}): { errors: Violation[]; warnings: Violation[] } {
  const context = opts.context ?? deriveContext(env);
  const strict = opts.strict ?? (context === "ci" || !!opts.profile);
  const condOpts: CondOpts = { assumeCredentials: opts.assumeCredentials, defaultOf: (n) => byName(n)?.default };
  const errors: Violation[] = [];
  const warnings: Violation[] = [];

  const push = (rule: RuleId, flag: string, severity: "error" | "warn", message: string, fix: string) => (severity === "error" ? errors : warnings).push({ rule, flag, severity, message, fix });

  // FR-01: an unregistered build-time name. (The source scan covers names read in code; see scan.ts.)
  for (const key of Object.keys(env)) {
    if (key.startsWith("NEXT_PUBLIC_") && !key.startsWith("NEXT_PUBLIC_VERCEL_") && !isRegistered(key)) {
      push("FR-01", key, "error", `${key} is a NEXT_PUBLIC_ name that is not in the flag registry, so nothing documents or validates it.`, "Register it in src/lib/flags/registry.ts, or remove it from the environment.");
    }
  }

  for (const def of REGISTRY) {
    const raw = env[def.name];
    const isSet = present(env, def.name);

    // FR-02: the value must parse for its type.
    if (isSet && def.type !== "secret") {
      const problem = valueProblem(def, raw as string);
      if (problem) push("FR-02", def.name, strict ? "error" : "warn", problem, def.type === "bool" ? `Set ${def.name}=1 to turn it on, or unset it.` : `Correct ${def.name}.`);
    }

    // FR-05: a blocked flag is rejected in every profile and every environment.
    if (def.kind === "blocked" && isOn(env, def.name)) {
      push("FR-05", def.name, "error", `${def.name} is blocked: ${def.blockedReason ?? "it is a standing NOT-YET."}`, `Unset ${def.name}.`);
    }

    // requirements that hold whether or not the flag is on (always-required secrets)
    for (const r of def.requiresAlways) {
      if (r.contexts && !r.contexts.includes(context)) continue;
      if (!evalCond(r.cond, env, condOpts)) emit(r, def.name, "requires");
    }

    // requirements and conflicts apply while the flag is active
    const active = def.type === "bool" ? isOn(env, def.name) : def.activeWhen ? evalCond(def.activeWhen, env, condOpts) : false;
    if (!active) continue;

    for (const r of def.requires) {
      if (r.contexts && !r.contexts.includes(context)) continue;
      if (!evalCond(r.cond, env, condOpts)) emit(r, def.name, "requires");
    }
    for (const r of def.conflictsWith) {
      if (r.contexts && !r.contexts.includes(context)) continue;
      if (evalCond(r.cond, env, condOpts)) emit(r, def.name, "conflicts");
    }

    // FR-12: the recorded AI pilot sign-off lives in the database, which this function does not read.
    if (def.requiresAiSignoff && !isOn(env, "DEMO_MODE")) {
      push("FR-12", def.name, "warn", `${def.name} needs a recorded AI pilot sign-off before customer-facing use; the sign-off is stored in the database and cannot be checked from the environment.`, "Check Settings, AI pilot: the sign-off must be recorded and the person on the pilot list.");
    }
  }

  // FR-30: a rebuild is pending when the running environment differs from what the bundle was built with.
  if (opts.buildFlags) {
    const names = new Set([...Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_")), ...Object.keys(opts.buildFlags)]);
    for (const n of [...names].sort()) {
      if (!isRegistered(n)) continue;
      if (isOn(env, n) !== (opts.buildFlags[n] === "1")) {
        push("FR-30", n, "warn", `${n} differs from the value this bundle was built with, so the running screens do not match the environment.`, "Rebuild and redeploy to apply a NEXT_PUBLIC_* change.");
      }
    }
  }

  function emit(r: Requirement, flag: string, _kind: "requires" | "conflicts") {
    const severity = r.severity === "warn" && r.strictError && strict ? "error" : r.severity;
    push(r.rule, flag, severity, r.message, r.fix);
  }

  const order = (a: Violation, b: Violation) => a.rule.localeCompare(b.rule) || a.flag.localeCompare(b.flag);
  return { errors: errors.sort(order), warnings: warnings.sort(order) };
}

/** What the startup check does with a result: which findings are fatal in a production boot. */
export const isFatal = (v: Violation): boolean => v.severity === "error" && FATAL_RULES.has(v.rule);
