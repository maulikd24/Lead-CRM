import { prisma } from "@/lib/db/prisma";
import type { RuleChange } from "@/lib/partners/rule-plan";
import { applyOverrideRuleChange, checkOverrideRuleChange } from "@/lib/partners/overrides/store";
import { registerApproval } from "../registry";

// A override rule change is maker-checker: Admin or Finance proposes, a DIFFERENT Admin or Finance person approves (service.ts refuses the
// same person doing both, and the store checks it again). The precheck re-validates the change against today's rules before it is recorded.
registerApproval<RuleChange>({
  actionType: "PARTNER_OVERRIDE_RULE_CHANGE",
  entity: "PartnerOverrideRule",
  canRequest: (actor) => actor.role === "FINANCE" || actor.role === "ADMIN",
  canDecide: (actor) => actor.role === "FINANCE" || actor.role === "ADMIN",
  precheck: async (payload) => checkOverrideRuleChange(prisma as never, payload, new Date()),
  apply: async (payload, ctx) => applyOverrideRuleChange(prisma as never, payload, ctx, new Date()),
});
