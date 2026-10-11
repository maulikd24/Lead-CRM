/**
 * Shared types and helpers for the creative and report server actions. Access is NOT decided here: each action file calls requireMarketing()
 * (the central registry, lib/access/policy.ts) for the area its policy names, then checks its feature flag. See creative-actions.ts.
 */
export type Actor = { id: string; role: string };
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const OFF = { ok: false as const, error: "This feature is switched off on this server." };

export const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
