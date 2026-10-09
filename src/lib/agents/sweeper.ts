import type { ProposalStatus } from "./proposal-state";
import type { TransitionPatch } from "./decide";

/** A claim this old is not an in-flight request any more; a send never takes anywhere near this long. */
export const STUCK_APPROVAL_MS = 15 * 60 * 1000;

export type StuckRow = { id: string; clientId: string; decidedById: string | null; decidedAt: Date | null; expiresAt: Date };
export type SweepMessage = { id: string; clientId: string; senderUserId: string | null; createdAt: Date };
export type SweepAction = { id: string; to: "SENT"; messageId: string } | { id: string; to: "DRAFT" | "EXPIRED" };

/**
 * Pure. For APPROVED rows older than STUCK_APPROVAL_MS: if an outbound message from the approving user to that customer exists
 * since the approval, the send happened (SENT, with that message); otherwise give the draft back (DRAFT) so the RM can retry,
 * or EXPIRED if it ran out meanwhile. `messages` must be OUTBOUND ones.
 */
export function planSweep(rows: StuckRow[], messages: SweepMessage[], now: Date): SweepAction[] {
  const actions: SweepAction[] = [];
  for (const r of rows) {
    if (!r.decidedAt || now.getTime() - r.decidedAt.getTime() < STUCK_APPROVAL_MS) continue;
    const decidedAt = r.decidedAt.getTime();
    const sent = messages
      .filter((m) => m.clientId === r.clientId && m.senderUserId !== null && m.senderUserId === r.decidedById && m.createdAt.getTime() >= decidedAt)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (sent) actions.push({ id: r.id, to: "SENT", messageId: sent.id });
    else actions.push({ id: r.id, to: r.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : "DRAFT" });
  }
  return actions;
}

export type SweepDeps = {
  /** APPROVED wa_nudger rows with decidedAt at or before `cutoff`. */
  loadStuck: (cutoff: Date) => Promise<StuckRow[]>;
  /** OUTBOUND messages for these rows' customers created since the earliest approval. */
  loadMessages: (rows: StuckRow[]) => Promise<SweepMessage[]>;
  /** The same atomic compare-and-set the approve path uses: true only if the row was still in `from`. */
  transition: (id: string, from: ProposalStatus, to: ProposalStatus, patch?: TransitionPatch) => Promise<boolean>;
  now: () => Date;
};

export type SweepCounts = { sent: number; released: number; expired: number; lostRace: number };

export async function sweepStuckApprovals(deps?: SweepDeps): Promise<SweepCounts> {
  const d = deps ?? (await import("./wiring")).sweepDeps();
  const counts: SweepCounts = { sent: 0, released: 0, expired: 0, lostRace: 0 };
  const now = d.now();
  const rows = await d.loadStuck(new Date(now.getTime() - STUCK_APPROVAL_MS));
  if (rows.length === 0) return counts;
  const plan = planSweep(rows, await d.loadMessages(rows), now);
  for (const a of plan) {
    try {
      const won = await d.transition(a.id, "APPROVED", a.to, a.to === "SENT" ? { messageId: a.messageId } : undefined);
      if (!won) counts.lostRace += 1; // the approve path (or another sweep) moved it first; its result stands
      else if (a.to === "SENT") counts.sent += 1;
      else if (a.to === "DRAFT") counts.released += 1;
      else counts.expired += 1;
    } catch (error) {
      console.error(`agent sweeper: could not resolve proposal ${a.id}`, error);
    }
  }
  return counts;
}
