import { registerApproval } from "../registry";

/**
 * A customer-facing message drafted by the AI execution layer (08). Approving it is the human decision that lets it go out
 * (L4: execute after human approval). It is never automatic: the autonomy ceiling for customer sends is L4.
 *
 * `apply` deliberately does NOT send anything. Sending is a separate, gated step (src/lib/ai-execution/approval.ts), and the
 * send path itself is an owner decision that is not wired yet. Approval alone never reaches a customer.
 */
const DECIDER_ROLES: readonly string[] = ["RM", "MANAGER", "ADMIN"];

registerApproval<{ clientId: string; body: string }>({
  actionType: "CUSTOMER_MESSAGE_DRAFT",
  entity: "Client",
  canRequest: (actor) => DECIDER_ROLES.includes(actor.role),
  // The maker-checker rule in service.ts still applies: the person who asked for the draft cannot approve it.
  canDecide: (actor) => DECIDER_ROLES.includes(actor.role),
  apply: async () => {
    // No side effect. The gated dispatch in ai-execution/approval.ts is the only route to a send, and it is not wired.
  },
});
