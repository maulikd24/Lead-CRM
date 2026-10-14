/** Pure logic for the Leads pipeline board (flag NEXT_PUBLIC_KANBAN). No React, no database: everything here is unit tested. */

export type BoardStage = { id: string; name: string; sequence: number };
export type BoardCard = {
  id: string;
  name: string;
  code: string;
  stageId: string;
  rmId: string | null;
  rmName: string | null;
  /** Campaign name from the lead's attribution, when it came from an ad or a tagged link. */
  campaign: string | null;
  createdAtIso: string;
  /** When the first outreach was recorded, if any (the speed-to-lead stop). */
  firstContactAtIso: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  /** Customer category set on the lead: Wealth, Broking, and so on. */
  category?: string | null;
};
export type BoardColumn = { stage: BoardStage; cards: BoardCard[] };

/** One column per stage, in sequence order (empty ones included), cards keep their given order. A card on an unknown stage is left off. */
export function groupByStage(stages: readonly BoardStage[], cards: readonly BoardCard[]): BoardColumn[] {
  return [...stages]
    .sort((a, b) => a.sequence - b.sequence)
    .map((stage) => ({ stage, cards: cards.filter((c) => c.stageId === stage.id) }));
}

/** A new list with one card's stage changed (optimistic update). Unknown card or same stage: the list is returned unchanged. */
export function moveCard(cards: readonly BoardCard[], cardId: string, toStageId: string): BoardCard[] {
  const current = cards.find((c) => c.id === cardId);
  if (!current || current.stageId === toStageId) return [...cards];
  return cards.map((c) => (c.id === cardId ? { ...c, stageId: toStageId } : c));
}

/** The stage one column left (-1) or right (+1) of `from`, staying put at the ends. Used by the keyboard drag. */
export function neighbourStage(stages: readonly BoardStage[], from: string, dir: 1 | -1): string {
  const ordered = [...stages].sort((a, b) => a.sequence - b.sequence);
  const i = ordered.findIndex((s) => s.id === from);
  if (i < 0) return from;
  return ordered[Math.min(ordered.length - 1, Math.max(0, i + dir))].id;
}

/** Only admins and managers may move a stage, the same rule as the real manual stage correction. Everyone else gets a read-only board. */
export function canMoveStages(role: string): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/** An RM can move their OWN pre-KYC leads (the separate, narrower action); true for no other role. */
export function canMoveOwnLeads(role: string): boolean {
  return role === "RM";
}

/**
 * The pre-KYC stages an RM may move their OWN lead between by hand. Every later stage (KYC completed, funds, dealer introduction,
 * onboarding completed) is set by the KYC, funding and dealer flows, so a drag can never skip to it or out of it.
 */
export const RM_MOVABLE_STAGES = ["New Lead", "Submitted for KYC"] as const;

export type RmMoveVerdict = { ok: true } | { ok: false; error: string };

/**
 * Whether an RM's board move is allowed on the stages alone (ownership is the policy rule `lead:stage_move_own`).
 * `hasKycRecord`: a KYC submission exists, so moving into "Submitted for KYC" cannot fake a step the KYC flow owns.
 */
export function rmMoveVerdict(stages: readonly BoardStage[], fromStageId: string, toStageId: string, lead: { active: boolean; hasKycRecord: boolean }): RmMoveVerdict {
  const from = stages.find((s) => s.id === fromStageId);
  const to = stages.find((s) => s.id === toStageId);
  const movable = (name: string) => (RM_MOVABLE_STAGES as readonly string[]).includes(name);
  if (!from || !to) return { ok: false, error: "That stage is not available." };
  if (!lead.active) return { ok: false, error: "A lead that is on hold, closed or archived cannot be moved." };
  if (from.id === to.id) return { ok: false, error: "The lead is already in that stage." };
  if (!movable(from.name)) return { ok: false, error: `This lead is already past the pre-KYC stages; "${from.name}" moves with the KYC, funding and dealer steps.` };
  if (!movable(to.name)) return { ok: false, error: `"${to.name}" is set by the KYC, funding and dealer steps, not by hand.` };
  if (to.sequence > from.sequence && !lead.hasKycRecord) return { ok: false, error: "Submit the KYC from the client page; the stage follows." };
  return { ok: true };
}

/** The audit reason recorded with a board move (the stage correction requires one). */
export function moveReason(from: string, to: string, undo = false): string {
  return undo ? `Undo: moved back from ${from} to ${to} on the pipeline board` : `Moved from ${from} to ${to} on the pipeline board`;
}

/** The first response a lead should get within this many minutes. */
export const SPEED_TO_LEAD_TARGET_MIN = 15;

export function formatWait(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / (60 * 24))}d`;
}

export type SpeedToLead = { state: "waiting" | "met" | "late"; label: string; minutes: number; /** True only for an uncontacted lead past the target: the one real warning on a card. */ warn: boolean };

/** Speed to lead: how long a lead has waited for a first contact, or how fast it was reached. */
export function speedToLead(createdAtIso: string, firstContactAtIso: string | null, nowMs: number): SpeedToLead {
  const start = Date.parse(createdAtIso);
  if (firstContactAtIso) {
    const minutes = Math.max(0, Math.floor((Date.parse(firstContactAtIso) - start) / 60_000));
    return { state: minutes <= SPEED_TO_LEAD_TARGET_MIN ? "met" : "late", label: `Reached in ${formatWait(minutes)}`, minutes, warn: false };
  }
  const minutes = Math.max(0, Math.floor((nowMs - start) / 60_000));
  return { state: "waiting", label: `Waiting ${formatWait(minutes)}`, minutes, warn: minutes > SPEED_TO_LEAD_TARGET_MIN };
}

export const announceLift = (name: string, stage: string, position: number, total: number) =>
  `Picked up ${name}, in ${stage}, position ${position} of ${total}. Use the left and right arrow keys to choose a stage, Space to drop, Escape to cancel.`;
export const announceOver = (name: string, stage: string) => `${name} over ${stage}.`;
export const announceDrop = (name: string, stage: string) => `${name} moved to ${stage}.`;
export const announceCancel = (name: string) => `Move cancelled. ${name} stays where it was.`;
