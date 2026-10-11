import type { Env } from "./cond";
import { deriveContext, isFatal, validateFlags } from "./validate";
import type { Violation } from "./types";

/**
 * The startup flag check, called from src/instrumentation.ts when a server instance starts.
 *
 * - Production: an error from one of the safety rules (FR-05, FR-10, FR-11, FR-13, FR-14) stops the boot, so a misconfigured
 *   outbound combination can never run. Every other finding is logged once as `{"event":"flag_check",...}`.
 * - FLAG_CHECK=warn is the break-glass: it downgrades the abort to a loud error log, and the event records that it was used.
 * - Development and everything else: warn only, never stop.
 * - `next build` is skipped (the build box does not hold the production environment).
 *
 * Output names rules and flags, never an environment value.
 */

export interface FlagCheckEvent {
  event: "flag_check";
  context: string;
  breakGlass: boolean;
  aborted: boolean;
  errors: Pick<Violation, "rule" | "flag" | "message" | "fix">[];
  warnings: Pick<Violation, "rule" | "flag" | "message" | "fix">[];
}

const slim = (v: Violation) => ({ rule: v.rule, flag: v.flag, message: v.message, fix: v.fix });

export function flagCheckEvent(env: Env, o: { aborted?: boolean } = {}): FlagCheckEvent {
  const r = validateFlags(env);
  return { event: "flag_check", context: deriveContext(env), breakGlass: env.FLAG_CHECK === "warn", aborted: !!o.aborted, errors: r.errors.map(slim), warnings: r.warnings.map(slim) };
}

let done = false;
/** Tests only: lets a second call run again. */
export const resetFlagCheckForTests = () => {
  done = false;
};

export function enforceFlagCheck(env: Env): void {
  if (done) return;
  if (env.NEXT_PHASE === "phase-production-build") return;
  done = true;

  const production = env.NODE_ENV === "production";
  const result = validateFlags(env);
  const fatal = result.errors.filter(isFatal);
  const breakGlass = env.FLAG_CHECK === "warn";
  const abort = production && fatal.length > 0 && !breakGlass;
  const anything = result.errors.length + result.warnings.length > 0;

  if (!production) {
    if (!anything) return;
    const lines = [...result.errors, ...result.warnings].map((v) => `  ${v.severity === "error" ? "error" : "warn "} ${v.rule} ${v.flag}: ${v.message}`);
    console.warn(`[flags] ${result.errors.length} errors, ${result.warnings.length} warnings (development: nothing is stopped)\n${lines.join("\n")}`);
    return;
  }

  const event = flagCheckEvent(env, { aborted: abort });
  if (abort) {
    console.error(JSON.stringify(event));
    const list = fatal.map((v) => `${v.rule} ${v.flag}: ${v.message}`).join(" | ");
    throw new Error(`Flag check failed, refusing to start (${fatal.length} safety error${fatal.length === 1 ? "" : "s"}): ${list} To start anyway, set FLAG_CHECK=warn (break-glass; it is logged and shown as a warning).`);
  }
  if (breakGlass && fatal.length > 0) {
    console.error(`FLAG_CHECK=warn is set: ${fatal.length} safety error${fatal.length === 1 ? "" : "s"} would have stopped this start. Fix the combination and unset FLAG_CHECK.`);
    console.error(JSON.stringify(event));
    return;
  }
  if (anything) console.warn(JSON.stringify(event));
}
