import { mayMerge, type MergeActor, type MergeParty } from "@/lib/clients/merge-policy";

/**
 * What a viewer may see of one open duplicate pair (owner decision: RMs review and merge their own duplicates; a pair that
 * spans another owner or the unassigned pool is only ever sent to a manager).
 * - "full": both customers are visible and the viewer may decide (admin, manager, or an RM who owns both);
 * - "restricted": an RM who owns ONE of the two. They see their own customer and that a possible duplicate exists, never
 *   the other customer, and the only action is "Ask a manager to review";
 * - "none": nothing, answered exactly like a pair that does not exist.
 */
export type ReviewAccess = "full" | "restricted" | "none";

export function reviewAccess(actor: MergeActor, parties: MergeParty[]): ReviewAccess {
  if (actor.role === "ADMIN" || actor.role === "MANAGER") return "full";
  if (actor.role !== "RM") return "none";
  if (!parties.some((p) => p.assignedToId === actor.id)) return "none";
  return mayMerge(actor, parties) ? "full" : "restricted";
}

export type SideView = { id: string; first: string; code: string };

/** Stands in for a customer the RM does not own. Carries nothing about it. */
export const HIDDEN_SIDE: SideView = { id: "", first: "A customer not assigned to you", code: "" };

/** One side of a pair as this viewer may see it. */
export function visibleSide(actor: MergeActor, party: MergeParty, side: SideView): SideView {
  if (actor.role === "RM" && party.assignedToId !== actor.id) return HIDDEN_SIDE;
  return side;
}
