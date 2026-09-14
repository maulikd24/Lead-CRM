import { CLIENT_RULES } from "./rules/clients";
import type { Actor, Decision, PolicyAction, PolicyResource } from "./types";

type Rule = (actor: Actor, resource?: PolicyResource) => Promise<Decision> | Decision;

const RULES: Partial<Record<PolicyAction, Rule>> = {
  ...CLIENT_RULES,
};

/**
 * Single entry point for every NEW authorization check in the Distribution OS. Existing
 * requireRole()/getVisibleUserIds() callsites are NOT required to migrate to this — can() is
 * additive, for new resources/actions that don't have an existing hand-rolled check.
 */
export async function can(actor: Actor, action: PolicyAction, resource?: PolicyResource): Promise<Decision> {
  const rule = RULES[action];
  if (!rule) return { effect: "DENY", reason: `No policy rule registered for action "${action}"` };
  return rule(actor, resource);
}
