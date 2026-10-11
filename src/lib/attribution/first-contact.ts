/**
 * When a person of ours first reached the customer. One definition, used by the Journey, the speed-to-lead timer and the
 * lead leakage view, so they can never disagree. Pure.
 *
 * Counts: a connected call (a device-recorded call needs an answered, non-missed, non-rejected direction and at least a
 * second of talk time; a call someone logged by hand counts as logged), a logged contact or meeting, and an outbound message
 * a person sent (a CRM user, or mirrored from the phone) that did not fail.
 * Does not count: notes, completed tasks, automation, customer messages, missed or unanswered calls.
 */
export type ContactSignal =
  | { kind: "activity"; type: string; at: Date; userId: string | null; call: { direction: string; durationSeconds: number } | null }
  | { kind: "message"; direction: "INBOUND" | "OUTBOUND"; at: Date; senderUserId: string | null; status: string; origin: string | null };

const CONNECTED_DIRECTIONS = new Set(["OUTGOING", "INCOMING"]);

function counts(s: ContactSignal): boolean {
  if (s.kind === "message") {
    if (s.direction !== "OUTBOUND" || s.status === "FAILED") return false;
    return s.senderUserId !== null || s.origin === "phone";
  }
  if (s.userId === null) return false;
  if (s.type === "CONTACT" || s.type === "MEETING") return true;
  if (s.type !== "CALL") return false;
  if (!s.call) return true;
  return CONNECTED_DIRECTIONS.has(s.call.direction) && s.call.durationSeconds > 0;
}

export function firstContactAt(signals: ContactSignal[], after: Date): Date | null {
  let best: Date | null = null;
  for (const s of signals) {
    if (s.at.getTime() < after.getTime() || !counts(s)) continue;
    if (!best || s.at.getTime() < best.getTime()) best = s.at;
  }
  return best;
}
