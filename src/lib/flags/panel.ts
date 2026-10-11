import type { Env } from "./cond";
import { conflictsWith, dependsOn } from "./describe";
import { PROFILES, PROFILE_NAMES } from "./profiles";
import { REGISTRY, isFlagDef } from "./registry";
import { isOn } from "./cond";
import { validateFlags } from "./validate";
import type { FlagDef, Kind, ProfileName, RuleId } from "./types";

/**
 * Everything the Admin "Flags" tab shows, built from the registry and an environment object. Pure: the page passes
 * process.env. Secrets, addresses and paths appear only as "set" or "not set"; a value is shown only for a setting the
 * registry marks safe. No value of any credential reaches this object.
 */

export type EffectiveState = "on" | "off" | "invalid" | "set" | "not set" | "value" | "default";

export interface FlagRow {
  name: string;
  kind: Kind;
  type: FlagDef["type"];
  owner: string;
  label: string;
  enables: string;
  /** "build" for NEXT_PUBLIC_* (fixed when the app was built), else "run". */
  setAt: "build" | "run";
  default: string;
  effective: { state: EffectiveState; value?: string };
  dependsOn: string[];
  conflictsWith: string[];
  findings: { rule: RuleId; severity: "error" | "warn"; message: string }[];
  inFlight?: string;
  approval?: string;
  blocked: boolean;
}

export interface PanelFinding {
  rule: RuleId;
  flag: string;
  severity: "error" | "warn";
  message: string;
  fix: string;
}

export interface ProfileComparison {
  name: ProfileName;
  purpose: string;
  /** Switches whose on/off state equals the profile's, out of `total` (flags awaiting approval are not counted). */
  matches: number;
  total: number;
  extraHere: string[];
  missingHere: string[];
  pendingApproval: string[];
}

export interface FlagsPanelData {
  summary: { registered: number; switches: number; on: number; buildTimeOn: number; errors: number; warnings: number };
  findings: PanelFinding[];
  rows: FlagRow[];
  profiles: ProfileComparison[];
  closestProfile: ProfileName;
}

const has = (env: Env, n: string) => typeof env[n] === "string" && (env[n] as string).trim() !== "";

function effective(def: FlagDef, env: Env): FlagRow["effective"] {
  const set = has(env, def.name);
  if (def.type === "bool") {
    if (isOn(env, def.name)) return { state: "on" };
    return set && env[def.name] !== "0" ? { state: "invalid" } : { state: "off" };
  }
  if (!set) return def.default !== null ? { state: "default", value: def.default } : { state: "not set" };
  const showable = def.safeToShow && def.type !== "secret" && def.type !== "url" && def.type !== "path";
  if (showable) return { state: "value", value: String(env[def.name]).slice(0, 120) };
  return { state: "set" };
}

export function buildFlagsPanel(env: Env): FlagsPanelData {
  const verdict = validateFlags(env);
  const all = [...verdict.errors, ...verdict.warnings];
  const findings: PanelFinding[] = all.map((v) => ({ rule: v.rule, flag: v.flag, severity: v.severity, message: v.message, fix: v.fix }));

  const rows: FlagRow[] = REGISTRY.map((def) => ({
    name: def.name,
    kind: def.kind,
    type: def.type,
    owner: def.owner,
    label: def.label,
    enables: def.enables,
    setAt: def.exposure === "public" ? "build" : "run",
    default: def.type === "bool" ? "off" : (def.default ?? "unset"),
    effective: effective(def, env),
    dependsOn: dependsOn(def),
    conflictsWith: conflictsWith(def),
    findings: all.filter((v) => v.flag === def.name).map((v) => ({ rule: v.rule, severity: v.severity, message: v.message })),
    inFlight: def.inFlight,
    approval: def.approval,
    blocked: def.kind === "blocked",
  }));

  const switches = REGISTRY.filter((d) => isFlagDef(d) && !d.inFlight);
  const profiles: ProfileComparison[] = PROFILE_NAMES.map((name) => {
    const p = PROFILES[name];
    const pending = [...p.needsApproval];
    const compared = switches.filter((d) => !pending.includes(d.name));
    const extraHere: string[] = [];
    const missingHere: string[] = [];
    let matches = 0;
    for (const d of compared) {
      const here = isOn(env, d.name);
      const there = p.values[d.name] === "1";
      if (here === there) matches++;
      else if (here) extraHere.push(d.name);
      else missingHere.push(d.name);
    }
    return { name, purpose: p.purpose, matches, total: compared.length, extraHere, missingHere, pendingApproval: pending };
  });
  const closest = [...profiles].sort((a, b) => b.matches - a.matches)[0];

  return {
    summary: {
      registered: REGISTRY.length,
      switches: REGISTRY.filter(isFlagDef).length,
      on: REGISTRY.filter((d) => isFlagDef(d) && isOn(env, d.name)).length,
      buildTimeOn: REGISTRY.filter((d) => isFlagDef(d) && d.exposure === "public" && isOn(env, d.name)).length,
      errors: verdict.errors.length,
      warnings: verdict.warnings.length,
    },
    findings,
    rows,
    profiles,
    closestProfile: closest.name,
  };
}
