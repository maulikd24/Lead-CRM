import { prisma } from "@/lib/db/prisma";
import { applyDestinationChange, checkDestinationChange, DESTINATION_ENTITY, type ApprovalDb } from "@/lib/closedloop/approvals";

import { registerApproval } from "../registry";

// Switching an ad destination on (or letting it reach further) is maker-checker: an Admin proposes, a DIFFERENT Admin approves (service.ts refuses the same
// person doing both). The precheck proves the destination really is set up; the apply writes the settings only and is idempotent.
registerApproval<unknown>({
  actionType: "CLOSED_LOOP_DESTINATION",
  entity: DESTINATION_ENTITY,
  canRequest: (actor) => actor.role === "ADMIN",
  canDecide: (actor) => actor.role === "ADMIN",
  precheck: async (payload) => checkDestinationChange(payload, prisma as unknown as ApprovalDb),
  apply: async (payload, ctx) => applyDestinationChange(payload, ctx, prisma as unknown as ApprovalDb),
});
