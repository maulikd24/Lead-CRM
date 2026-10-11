/**
 * The ONLY places the ledger guesses. Each heuristic links two records that carry no id between them, by customer and time window. Every link a heuristic makes is
 * marked `inferred` in the entry, shows `because` in plain words, and carries the fixed `score` below: a rank of how much to trust the guess, not a probability.
 * `supporting` links only attach telemetry (a model run, an audit row) and never change the story, so they do not lower an entry's confidence; the others do.
 *
 * Why these exist: on the legacy paths an AgentProposal does not store the model run's correlation id, a Task does not name the complaint it follows, and an RM's
 * message does not name the recommendation behind it. The fix is to write the id at the source; until then the reader says "inferred", never "certain".
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

export type HeuristicId = "run_to_draft" | "complaint_to_task" | "decision_to_message" | "audit_to_stage";

export type Heuristic = { id: HeuristicId; windowMs: number; score: number; supporting: boolean; because: string; trigger: string };

export const HEURISTICS: Record<HeuristicId, Heuristic> = {
  run_to_draft: {
    id: "run_to_draft", windowMs: 10 * MIN, score: 0.7, supporting: true,
    because: "Same customer and same agent; the model run finished within 10 minutes before the draft was saved. The draft does not store the run's id.",
    trigger: "Model run",
  },
  complaint_to_task: {
    id: "complaint_to_task", windowMs: 24 * HOUR, score: 0.5, supporting: false,
    because: "Same customer; the task was created within 24 hours after the complaint was resolved. Nothing on the task names the complaint, so it may be unrelated.",
    trigger: "Possibly follows the resolved complaint",
  },
  decision_to_message: {
    id: "decision_to_message", windowMs: 48 * HOUR, score: 0.4, supporting: false,
    because: "Same customer and channel; the message was sent within 48 hours after the recommendation. Nothing on the message names the decision, so it may be unrelated.",
    trigger: "Possibly follows a recommendation",
  },
  audit_to_stage: {
    id: "audit_to_stage", windowMs: 2 * MIN, score: 0.6, supporting: true,
    because: "Same person and customer; the audit row was written within two minutes of the stage change.",
    trigger: "Audit row",
  },
};

/** Whether `later` falls inside the heuristic's window after `earlier` (never before it). `slackMs` tolerates tiny clock differences between two writes. */
export function withinWindow(earlier: Date, later: Date, windowMs: number, slackMs = 0): boolean {
  const d = later.getTime() - earlier.getTime();
  return d >= -slackMs && d <= windowMs;
}
