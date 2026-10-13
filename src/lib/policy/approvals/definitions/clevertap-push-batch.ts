import { CLEVERTAP_BATCH_ENTITY } from "@/lib/integrations/clevertap/push-approval";

import { registerApproval } from "../registry";

// Maker-checker like the other outbound approvals: an Admin requests the batch (requestCleverTapPushBatch freezes the selected client ids and region into the payload), a DIFFERENT Admin approves it (service.ts enforces that).
// The push tick sends exactly the approved list, once: it claims the approved request (claimApprovedBatch) before the first send. apply has nothing to run, so it is a no-op.
registerApproval<unknown>({
  actionType: "CLEVERTAP_PUSH_BATCH",
  entity: CLEVERTAP_BATCH_ENTITY,
  canRequest: (actor) => actor.role === "ADMIN",
  canDecide: (actor) => actor.role === "ADMIN",
  apply: async () => {},
});
