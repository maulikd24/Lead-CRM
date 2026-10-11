import { getVisibleScope } from "../visibility";
import type { Actor, Decision, PolicyAction, PolicyResource } from "../types";

type Rule = (actor: Actor, resource?: PolicyResource) => Promise<Decision> | Decision;

/**
 * Closes a write-path gap surfaced during the Distribution OS investigation: actions like
 * bulkReassignClientsAction/correctStageAction check the actor's role but never re-check whether
 * the specific target client is actually in the actor's visible scope. New callsites should route
 * through here; existing ones are left as-is (role gate only) to avoid a behavior change without a
 * dedicated review pass.
 */
export const CLIENT_RULES: Partial<Record<PolicyAction, Rule>> = {
  "client:reassign": async (actor, resource) => {
    if (resource?.type !== "client") return { effect: "DENY", reason: "resource required" };
    if (actor.role !== "ADMIN" && actor.role !== "MANAGER") {
      return { effect: "DENY", reason: "Only ADMIN/MANAGER may reassign clients" };
    }
    const scope = await getVisibleScope(actor.id, actor.role);
    if (scope.userIds && resource.assignedToId && !scope.userIds.includes(resource.assignedToId)) {
      return { effect: "DENY", reason: "Target client is outside your visible scope" };
    }
    return { effect: "ALLOW", reason: "In-scope reassignment by ADMIN/MANAGER" };
  },

  "client:stage_override": (actor) => {
    if (actor.role === "ADMIN") return { effect: "ALLOW", reason: "Admin self-override" };
    if (actor.role === "MANAGER") return { effect: "REQUIRE_APPROVAL", reason: "Manager overrides route through maker-checker" };
    return { effect: "DENY", reason: "Only ADMIN/MANAGER may override stage gates" };
  },

  // The RM-safe board move (owner decision 12 Oct 2026): an RM may move only a lead assigned to them. Which stages is decided by
  // rmMoveVerdict (pre-KYC only). Admin and Manager are DENIED here on purpose: they keep client:stage_override, with its approval flow.
  "lead:stage_move_own": (actor, resource) => {
    if (resource?.type !== "client") return { effect: "DENY", reason: "resource required" };
    if (actor.role !== "RM") return { effect: "DENY", reason: "Only an RM moves their own lead this way; admins and managers use the stage correction" };
    if (!resource.assignedToId || resource.assignedToId !== actor.id) return { effect: "DENY", reason: "You can only move a lead assigned to you" };
    return { effect: "ALLOW", reason: "RM moving their own lead" };
  },
};
