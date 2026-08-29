/** A single pre-flight condition for a stage-gate form: blocked when `condition` is true. */
export type GateCheck = { condition: boolean; message: string };

/** Centralizes the "disabled until X" pattern shared by every stage-gate form. */
export function useGateBlockers(checks: GateCheck[]): { blocked: boolean; messages: string[] } {
  const messages = checks.filter((c) => c.condition).map((c) => c.message);
  return { blocked: messages.length > 0, messages };
}
