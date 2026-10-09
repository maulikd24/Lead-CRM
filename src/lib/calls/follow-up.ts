const DAY = 24 * 60 * 60 * 1000;
const MAX_TITLE = 200;
const MAX_NOTE = 2000;

export const followUpSource = (activityId: string) => `calls-review:${activityId}`;

export function buildFollowUpTask(input: { title: string | null | undefined; recommendation: string | null | undefined; customerName: string; dueInDays?: number; now: Date }): { title: string; dueAt: Date } {
  const typed = (input.title ?? "").trim();
  const title = (typed || (input.recommendation ?? "").trim() || `Follow up with ${input.customerName} after call`).slice(0, MAX_TITLE);
  const days = Math.min(14, Math.max(1, Math.round(input.dueInDays ?? 1)));
  return { title, dueAt: new Date(input.now.getTime() + days * DAY) };
}

export function validateReviewNote(raw: string | null | undefined): { ok: true; note: string | null } | { ok: false; error: string } {
  const note = (raw ?? "").trim();
  if (note.length > MAX_NOTE) return { ok: false, error: `Keep the note under ${MAX_NOTE} characters.` };
  return { ok: true, note: note || null };
}
