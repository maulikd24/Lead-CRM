import { REGISTRY, isFlagDef } from "../flags/registry";

/**
 * The Admin status page's view of the flag registry (src/lib/flags/registry.ts, the single source of truth).
 * `FLAGS` is every on/off switch that exists in this code, `SETTINGS` the config values that are safe to show.
 * A flag is on only for the exact value "1". NEXT_PUBLIC_* flags are inlined at build time, so changing one needs a new
 * deployment. Names only: no secret and no URL ever belongs here.
 */
export type FlagDef = { name: string; buildTime: boolean; label: string };

export const FLAGS: FlagDef[] = REGISTRY.filter((f) => isFlagDef(f) && !f.inFlight).map((f) => ({ name: f.name, buildTime: f.exposure === "public", label: f.label }));

/** Values that are safe to show (never a secret): lists, hours, zones, names of models. */
export const SETTINGS: { name: string; label: string }[] = REGISTRY.filter((f) => f.kind === "config" && f.safeToShow && !f.inFlight && f.process === "app").map((f) => ({ name: f.name, label: f.label }));

export const flagIsOn = (env: Record<string, string | undefined>, name: string): boolean => env[name] === "1";
