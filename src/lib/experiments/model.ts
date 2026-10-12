/**
 * Experiment types and guardrails. Pure: no I/O, no environment reads, no database.
 *
 * An experiment splits customers or leads into arms (for example a current message and a new one). Weights are
 * whole percentages and must sum to exactly 100. Nothing here rolls a change out: the layer only says which arm a
 * subject belongs to and reads back what happened.
 */

export type ExperimentStatus = "draft" | "running" | "stopped";

export type Arm = { key: string; weight: number };

export type ExperimentErrorCode =
  | "WEIGHTS_NOT_100"
  | "BAD_ARMS"
  | "BAD_KEY"
  | "BAD_SUBJECT"
  | "BAD_OUTCOME"
  | "DRAFT_CANNOT_ASSIGN"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "BAD_STATUS"
  | "NOT_EXPOSED";

/** Typed error for every guardrail failure, so callers can branch on `code` instead of parsing messages. */
export class ExperimentError extends Error {
  readonly code: ExperimentErrorCode;
  constructor(code: ExperimentErrorCode, message: string) {
    super(message);
    this.name = "ExperimentError";
    this.code = code;
  }
}

/** Weights must sum to 100 (tolerance only for floating-point noise). */
export const WEIGHT_TOTAL = 100;
const WEIGHT_EPSILON = 1e-9;

/**
 * Checks an arm list: at least two arms, unique non-empty keys, finite non-negative weights summing to 100, and a
 * control arm that is one of the keys. Throws ExperimentError; returns the control key on success.
 */
export function validateArms(arms: readonly Arm[], control?: string): string {
  if (!Array.isArray(arms) || arms.length < 2) throw new ExperimentError("BAD_ARMS", "An experiment needs at least two arms.");
  const seen = new Set<string>();
  for (const arm of arms) {
    if (!arm || typeof arm.key !== "string" || arm.key.trim() === "") throw new ExperimentError("BAD_ARMS", "Every arm needs a non-empty key.");
    if (seen.has(arm.key)) throw new ExperimentError("BAD_ARMS", `Arm key "${arm.key}" appears more than once.`);
    seen.add(arm.key);
    if (typeof arm.weight !== "number" || !Number.isFinite(arm.weight) || arm.weight < 0) {
      throw new ExperimentError("BAD_ARMS", `Arm "${arm.key}" needs a finite, non-negative weight.`);
    }
  }
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0);
  if (Math.abs(total - WEIGHT_TOTAL) > WEIGHT_EPSILON) {
    throw new ExperimentError("WEIGHTS_NOT_100", `Arm weights must sum to ${WEIGHT_TOTAL} (they sum to ${total}).`);
  }
  const controlKey = control ?? arms[0].key;
  if (!seen.has(controlKey)) throw new ExperimentError("BAD_ARMS", `The control arm "${controlKey}" is not one of the arms.`);
  return controlKey;
}

export type Experiment = {
  key: string;
  arms: readonly Arm[];
  status: ExperimentStatus;
  /** The arm a stopped experiment falls back to, and the baseline every result is compared with. Defaults to the first arm. */
  control?: string;
};
