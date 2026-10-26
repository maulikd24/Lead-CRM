import { registerApproval } from "../registry";

/**
 * A WhatsApp or SMS broadcast drafted in Campaign Studio (/marketing/studio). Maker-checker like the other outbound marketing
 * approvals: Marketing or an Admin asks, a DIFFERENT Marketing user or Admin decides (service.ts enforces requester != decider).
 *
 * `apply` deliberately does NOT send anything. The payload freezes the audience filter, channel, template and variables; the bulk
 * send path is an owner decision that is not wired yet, and when it is it must re-run the consent filter at send time. Approval alone
 * never reaches a customer.
 */
export const BROADCAST_ENTITY = "Broadcast";
const ROLES: readonly string[] = ["ADMIN", "MARKETING"];

registerApproval<unknown>({
  actionType: "BROADCAST_DRAFT",
  entity: BROADCAST_ENTITY,
  canRequest: (actor) => ROLES.includes(actor.role),
  canDecide: (actor) => ROLES.includes(actor.role),
  apply: async () => {
    // No side effect: sending a broadcast is not wired.
  },
});
