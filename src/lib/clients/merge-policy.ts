/**
 * Who may merge which customers (owner decision):
 * - Admins and Managers may merge ANY two customers, whoever they are assigned to;
 * - an RM may merge only customers that are all assigned to them (an unassigned customer is not theirs);
 * - nobody else may merge.
 * A pair an RM cannot merge themselves can be sent to a manager ("Ask a manager to review", see ask-manager.ts).
 */
export type MergeActor = { id: string; role: string };
export type MergeParty = { assignedToId: string | null };

export function mayMerge(actor: MergeActor, parties: MergeParty[]): boolean {
  if (actor.role === "ADMIN" || actor.role === "MANAGER") return true;
  if (actor.role === "RM") return parties.every((c) => c.assignedToId === actor.id);
  return false;
}

/** An RM looking at a pair they may not merge: the pair spans another RM, or someone is unassigned. */
export function needsManagerReview(actor: MergeActor, parties: MergeParty[]): boolean {
  return actor.role === "RM" && parties.some((c) => c.assignedToId === actor.id) && !mayMerge(actor, parties);
}

/** A pair whose customers have different owners (or one has none): the pair "spans owners". */
export function spansOwners(parties: MergeParty[]): boolean {
  return new Set(parties.map((c) => c.assignedToId)).size > 1;
}
