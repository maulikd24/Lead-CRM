/**
 * What a stage is called on screen. The stored stage name never changes (stage rules, SLAs and reports key on it): only the label does.
 * "Onboarding Completed" is shown as "Handover Completed".
 */
const DISPLAY: Record<string, string> = { "Onboarding Completed": "Handover Completed" };

export const stageLabel = (name: string): string => DISPLAY[name] ?? name;

/** Stages that are finished the moment a customer is in them (KYC cannot reach "KYC completed" unless it was approved). */
const DONE_ON_ENTRY = new Set(["KYC completed"]);

/**
 * Whether the tracker draws a tick on a stage: every earlier stage, the final stage once the customer is Completed, and a stage that
 * is complete on entry. Without the last rule a customer sitting at "KYC completed" showed no tick on it.
 */
export function isStageDone(stage: { name: string; sequence: number }, current: { sequence: number; clientStatus: string }, isLast: boolean): boolean {
  if (stage.sequence < current.sequence) return true;
  if (stage.sequence !== current.sequence) return false;
  return (isLast && current.clientStatus === "COMPLETED") || DONE_ON_ENTRY.has(stage.name);
}
