import type { Actor } from "../../types";
import { registerApproval } from "../registry";
import { mayDecideCustomerDraft, productionOwnership } from "./customer-message-draft";

/**
 * A reply to a Freshdesk support ticket drafted by the support co-pilot (Support SLA screen). Approving it is the human decision that
 * lets it go to the customer. Only a Manager or an Admin may ask for it. The decider is the person who owns the customer (an RM), a
 * Manager with the customer in their team, or an Admin, and never the requester (service.ts re-checks that).
 *
 * `apply` deliberately does NOT send anything. The reply is sent by a separate, gated step (src/lib/support/copilot/send.ts) that only
 * the approver can run, after the approval is recorded and the draft passes its checks again.
 */
registerApproval<{ clientId: string; ticketId: string; body: string }>({
  actionType: "FRESHDESK_REPLY_DRAFT",
  entity: "Client",
  canRequest: (actor: Actor) => actor.role === "MANAGER" || actor.role === "ADMIN",
  canDecide: (actor, request) => (request ? mayDecideCustomerDraft(actor, request.entityId, productionOwnership) : false),
  apply: async () => {
    // No side effect. The gated send in src/lib/support/copilot/send.ts is the only route to Freshdesk.
  },
});
