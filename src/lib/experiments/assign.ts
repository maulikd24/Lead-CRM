import { bucketPercent } from "./hash";
import { type Arm, type ExperimentStatus, ExperimentError, validateArms } from "./model";

/**
 * Deterministic arm assignment for one subject (a customer or a lead id).
 *
 * - Same experiment key, subject id and arms always give the same arm. Nothing random, nothing per request.
 * - draft: throws DRAFT_CANNOT_ASSIGN. A draft has not started, so nobody is put into an arm.
 * - stopped: always returns the control arm, whatever the subject.
 * - running: the subject's position in [0, 100) picks the arm by cumulative weight. Zero-weight arms are never picked.
 * Bad arms (weights not summing to 100, duplicate keys, unknown control) throw before anything else.
 */
export function assign(
  experimentKey: string,
  subjectId: string,
  arms: readonly Arm[],
  opts: { status: ExperimentStatus; control?: string },
): string {
  if (typeof experimentKey !== "string" || experimentKey.trim() === "") throw new ExperimentError("BAD_KEY", "An experiment key is required.");
  if (typeof subjectId !== "string" || subjectId === "") throw new ExperimentError("BAD_SUBJECT", "A subject id is required.");
  const control = validateArms(arms, opts.control);
  if (opts.status === "draft") throw new ExperimentError("DRAFT_CANNOT_ASSIGN", `Experiment "${experimentKey}" is a draft and cannot assign subjects.`);
  if (opts.status === "stopped") return control;

  const u = bucketPercent(experimentKey, subjectId);
  let acc = 0;
  let last = control;
  for (const arm of arms) {
    if (arm.weight <= 0) continue;
    acc += arm.weight;
    last = arm.key;
    if (u < acc) return arm.key;
  }
  // Only reachable through floating-point rounding at the very top of the range.
  return last;
}
