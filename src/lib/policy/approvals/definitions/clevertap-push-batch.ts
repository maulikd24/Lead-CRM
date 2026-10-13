import { CLEVERTAP_BATCH_ENTITY } from "@/lib/integrations/clevertap/push-approval";

import { registerApproval } from "../registry";

// Maker-checker like the other outbound approvals: an Admin requests the batch, a DIFFERENT Admin approves it (service.ts enforces that).
// Approval only authorises the batch. The push itself reads the approved request (checkBatchApproval) before it sends anything, so apply has nothing to run.
registerApproval<unknown>({
  actionType: "CLEVERTAP_PUSH_BATCH",
  entity: CLEVERTAP_BATCH_ENTITY,
  canRequest: (actor) => actor.role === "ADMIN",
  canDecide: (actor) => actor.role === "ADMIN",
  apply: async () => {},
});
