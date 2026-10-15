import { prisma } from "@/lib/db/prisma";
import { applyConsentNotice, checkConsentNotice, CONSENT_ENTITY, type ApprovalDb } from "@/lib/closedloop/approvals";

import { registerApproval } from "../registry";

// The customer-facing ad measurement wording belongs to Compliance; the platform records who approved which version. Maker-checker like every consent-policy change.
registerApproval<unknown>({
  actionType: "CONSENT_POLICY_CHANGE",
  entity: CONSENT_ENTITY,
  canRequest: (actor) => actor.role === "ADMIN",
  canDecide: (actor) => actor.role === "ADMIN",
  precheck: async (payload) => checkConsentNotice(payload),
  apply: async (payload, ctx) => applyConsentNotice(payload, ctx, prisma as unknown as ApprovalDb),
});
