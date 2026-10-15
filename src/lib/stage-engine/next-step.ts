/**
 * The step that follows the client's current stage, read from the existing stage order (no new engine).
 * Nothing here sends a message or moves the client: it only names the next stage so the RM can act on it.
 */
export type StageRow = { name: string; sequence: number };
export type NextStep = { stageName: string; sequence: number };

export function nextStepForViewer(input: {
  stages: readonly StageRow[];
  currentSequence: number;
  clientStatus: "ACTIVE" | "ON_HOLD" | "COMPLETED" | "NOT_PROCEEDING";
  viewer: { id: string; role: string };
  ownerId: string | null;
}): NextStep | null {
  // Only live, active customers have a next step. Held, lost and completed ones do not.
  if (input.clientStatus !== "ACTIVE") return null;
  // An RM sees next steps only for leads they own. Managers and Admins see whatever the page already lets them open.
  if (input.viewer.role === "RM" && input.ownerId !== input.viewer.id) return null;
  const next = [...input.stages]
    .filter((s) => s.sequence > input.currentSequence)
    .sort((a, b) => a.sequence - b.sequence)[0];
  return next ? { stageName: next.name, sequence: next.sequence } : null;
}
