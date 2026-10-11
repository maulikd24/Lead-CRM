/**
 * The seven canonical states of an approval and the legal moves between them. Pure.
 *
 *   requested -> approved | rejected | expired | cancelled
 *   approved  -> executed | failed
 *   failed    -> approved (the claim was released and the action can be retried)
 * Legacy states map onto these in each adapter; this module never reads a legacy table.
 */
export const CANONICAL_STATES = ["requested", "approved", "rejected", "expired", "executed", "failed", "cancelled"] as const;
export type CanonicalState = (typeof CANONICAL_STATES)[number];

const EDGES: Record<CanonicalState, readonly CanonicalState[]> = {
  requested: ["approved", "rejected", "expired", "cancelled"],
  approved: ["executed", "failed"],
  failed: ["approved"],
  rejected: [],
  expired: [],
  executed: [],
  cancelled: [],
};

export const canMove = (from: CanonicalState, to: CanonicalState) => EDGES[from].includes(to);
export const isTerminal = (s: CanonicalState) => s === "rejected" || s === "expired" || s === "executed" || s === "cancelled";

/** An open request that is past its expiry reads as expired. A decision already made is never rewritten by the clock. */
export function effectiveState(state: CanonicalState, expiresAt: Date | null, now: Date): CanonicalState {
  return state === "requested" && expiresAt !== null && expiresAt.getTime() <= now.getTime() ? "expired" : state;
}
