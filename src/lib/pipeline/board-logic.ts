/**
 * Pure rules behind the pipeline board (/pipeline): what a drop means, how the board is filtered, and the
 * historical odds that a client in a stage goes on to complete onboarding (used for each column's weighted value).
 */

export const BOARD_FILTERS = [
  { key: "all", label: "All" },
  { key: "mine", label: "My clients" },
  { key: "hot", label: "Hot" },
  { key: "at-risk", label: "At risk" },
] as const;

export type BoardFilter = (typeof BOARD_FILTERS)[number]["key"];

export function parseBoardFilter(raw: string | undefined): BoardFilter {
  return BOARD_FILTERS.some((f) => f.key === raw) ? (raw as BoardFilter) : "all";
}

/** Roles that may move a client to any stage (a correction, with a reason — Managers via maker-checker approval). */
export const STAGE_CORRECTION_ROLES = ["ADMIN", "MANAGER"] as const;

export type DropIntent =
  | { kind: "none" }
  /** The next stage: opens that stage's own form, so every gate (documents, KYC approval, penny drop…) still applies. */
  | { kind: "advance" }
  /** Skipping ahead or going back: a stage correction with a reason. */
  | { kind: "correct" }
  /** Skipping ahead or going back, by someone who can't correct stages. */
  | { kind: "denied"; message: string };

export function classifyDrop(fromSequence: number, toSequence: number, role: string): DropIntent {
  if (fromSequence === toSequence) return { kind: "none" };
  if (toSequence === fromSequence + 1) return { kind: "advance" };
  if ((STAGE_CORRECTION_ROLES as readonly string[]).includes(role)) return { kind: "correct" };
  return {
    kind: "denied",
    message: toSequence < fromSequence
      ? "Only a Manager or Admin can move a client back a stage."
      : "Clients move one stage at a time. Complete the next stage first, or ask a Manager to correct the stage.",
  };
}

/** Fewer finished clients than this through a stage and its odds aren't shown — too few to mean anything. */
export const MIN_WIN_RATE_SAMPLE = 10;

/**
 * For each stage, the share of finished clients (completed or not proceeding) who reached it and went on to complete
 * onboarding. Every finished client counts as having reached the first stage. Null where the sample is too small.
 */
export function stageWinRates(
  stageIds: string[],
  finished: { reachedStageIds: string[]; completed: boolean }[],
  minSample = MIN_WIN_RATE_SAMPLE,
): Map<string, number | null> {
  const rates = new Map<string, number | null>();
  stageIds.forEach((stageId, index) => {
    const reached = finished.filter((c) => index === 0 || c.reachedStageIds.includes(stageId));
    rates.set(stageId, reached.length < minSample ? null : reached.filter((c) => c.completed).length / reached.length);
  });
  return rates;
}
