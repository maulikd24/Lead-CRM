import type { Cond } from "./types";

export type Env = Record<string, string | undefined>;

export interface CondOpts {
  assumeCredentials?: boolean;
  /** Effective default for a name when unset (from the registry). */
  defaultOf?: (name: string) => string | null | undefined;
}

const has = (env: Env, name: string) => typeof env[name] === "string" && (env[name] as string).trim() !== "";
export const isOn = (env: Env, name: string) => env[name] === "1";

/** The key that matches AI_PROVIDER (anthropic by default). */
export function aiKeyName(env: Env): "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" {
  return env.AI_PROVIDER === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
}

/** Host of a connection string, or null when it cannot be read. Never returns credentials or the path. */
function dbHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function evalCond(c: Cond, env: Env, o: CondOpts = {}): boolean {
  if ("on" in c) return isOn(env, c.on);
  if ("set" in c) return has(env, c.set);
  if ("eq" in c) {
    const v = has(env, c.eq) ? env[c.eq] : (o.defaultOf?.(c.eq) ?? undefined);
    return v === c.value;
  }
  if ("listHas" in c) return (env[c.listHas] ?? "").split(",").map((s) => s.trim().toUpperCase()).includes(c.value.toUpperCase());
  if ("cred" in c) return !!o.assumeCredentials || has(env, c.cred);
  if ("aiKey" in c) return !!o.assumeCredentials || isOn(env, "DEMO_MODE") || has(env, aiKeyName(env));
  if ("prod" in c) return env.VERCEL_ENV === "production";
  if ("dbNonLocal" in c) {
    if (!has(env, "DATABASE_URL")) return false;
    const host = dbHost(env.DATABASE_URL as string);
    // An unreadable string is treated as non-local: the safe reading for a "no live outbound under demo" rule.
    return host === null ? true : !LOCAL_HOSTS.has(host);
  }
  if ("matches" in c) return isOn(env, c.matches) === isOn(env, c.twin);
  if ("anyOf" in c) return c.anyOf.some((x) => evalCond(x, env, o));
  if ("allOf" in c) return c.allOf.every((x) => evalCond(x, env, o));
  return !evalCond(c.not, env, o);
}

/** Every env name a condition mentions (for the registry cross-check and for the docs). */
export function condNames(c: Cond): string[] {
  if ("on" in c) return [c.on];
  if ("set" in c) return [c.set];
  if ("eq" in c) return [c.eq];
  if ("listHas" in c) return [c.listHas];
  if ("cred" in c) return [c.cred];
  if ("aiKey" in c) return ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEMO_MODE"];
  if ("prod" in c) return ["VERCEL_ENV"];
  if ("dbNonLocal" in c) return ["DATABASE_URL"];
  if ("matches" in c) return [c.matches, c.twin];
  if ("anyOf" in c) return c.anyOf.flatMap(condNames);
  if ("allOf" in c) return c.allOf.flatMap(condNames);
  return condNames(c.not);
}

/** Credentials a condition may need (when it is under a positive requirement). Used to list what a profile needs. */
export function condCreds(c: Cond): string[] {
  if ("cred" in c) return [c.cred];
  if ("aiKey" in c) return ["ANTHROPIC_API_KEY or OPENAI_API_KEY"];
  if ("anyOf" in c) return c.anyOf.flatMap(condCreds);
  if ("allOf" in c) return c.allOf.flatMap(condCreds);
  return [];
}
