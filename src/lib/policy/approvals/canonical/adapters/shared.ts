import type { CanonicalState } from "../state";
import type { FailureCode, LegacyOutcome } from "../contract";

/**
 * Legacy paths report failures as plain sentences. This maps a sentence to a code in ONE place per adapter, with a test per phrase,
 * so a reworded legacy message shows up as a failing test instead of a wrong code. Unknown text is ERROR, never silently "ok".
 */
export function failure(error: string, rules: ReadonlyArray<readonly [RegExp, FailureCode]>, reasons?: string[]): LegacyOutcome {
  const code = rules.find(([re]) => re.test(error))?.[1] ?? "ERROR";
  return reasons?.length ? { ok: false, code, error, reasons } : { ok: false, code, error };
}

export const personOf = (id: string | null | undefined, name?: string | null) => (id ? { id, name: name ?? null } : null);
export const states = (map: Record<string, CanonicalState>, legacy: string, fallback: CanonicalState = "requested"): CanonicalState => map[legacy] ?? fallback;
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
