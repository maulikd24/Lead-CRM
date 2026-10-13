import type { Actor } from "../../types";
import { registerApproval } from "../registry";

/**
 * A customer-facing message drafted by the AI execution layer (08). Approving it is the human decision that lets it go out
 * (L4: execute after human approval). It is never automatic: the autonomy ceiling for customer sends is L4.
 *
 * `apply` deliberately does NOT send anything. Sending is a separate, gated step (src/lib/ai-execution/approval.ts), and the
 * send path itself is an owner decision that is not wired yet. Approval alone never reaches a customer.
 */
const DECIDER_ROLES: readonly string[] = ["RM", "MANAGER", "ADMIN"];

/** The two lookups an ownership rule needs. Injected so the rule is testable without a database. */
export type DraftOwnership = {
  /** The RM the customer is assigned to, or null when unassigned. */
  ownerOf: (clientId: string) => Promise<string | null>;
  /** The RM user ids a manager may see, or null when the manager is unrestricted. */
  visibleOwnerIds: (managerId: string) => Promise<string[] | null>;
};

/**
 * Who may approve a customer's draft: an RM only for a customer assigned to them; a MANAGER only for a customer whose RM is in their
 * visible set; an ADMIN for any customer. An unassigned customer is open to the ADMIN alone.
 */
export async function mayDecideCustomerDraft(actor: Actor, clientId: string, deps: DraftOwnership): Promise<boolean> {
  if (actor.role === "ADMIN") return true;
  if (actor.role !== "RM" && actor.role !== "MANAGER") return false;
  const owner = await deps.ownerOf(clientId);
  if (!owner) return false;
  if (actor.role === "RM") return owner === actor.id;
  const visible = await deps.visibleOwnerIds(actor.id);
  return visible === null || visible.includes(owner);
}

/** Production lookups, loaded on first use so this module can be imported without a database. */
export const productionOwnership: DraftOwnership = {
  ownerOf: async (clientId) => {
    const { prisma } = await import("@/lib/db/prisma");
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { assignedToId: true } });
    return client?.assignedToId ?? null;
  },
  visibleOwnerIds: async (managerId) => {
    const { getVisibleScope } = await import("@/lib/policy/visibility");
    return (await getVisibleScope(managerId, "MANAGER")).userIds;
  },
};

registerApproval<{ clientId: string; body: string }>({
  actionType: "CUSTOMER_MESSAGE_DRAFT",
  entity: "Client",
  canRequest: (actor) => DECIDER_ROLES.includes(actor.role),
  // The maker-checker rule in service.ts still applies: the person who asked for the draft cannot approve it.
  // Without the request there is no customer to check, so the rule fails closed.
  canDecide: (actor, request) => (request ? mayDecideCustomerDraft(actor, request.entityId, productionOwnership) : false),
  apply: async () => {
    // No side effect. The gated dispatch in ai-execution/approval.ts is the only route to a send, and it is not wired.
  },
});
