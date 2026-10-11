import type { Role } from "@/generated/prisma/client";
import { can as registryCan, type Action, type Area } from "@/lib/access/policy";

export type ReferralAction = "view" | "manage_rules" | "manage_referrers" | "manage_settings" | "refresh" | "prepare_statement" | "approve_statement" | "mark_paid" | "reverse_entry" | "clear_review";

/** Each referral action is one (area, action) pair in the central registry (src/lib/access/policy.ts). */
const REGISTRY: Record<ReferralAction, readonly [Area, Action]> = {
  view: ["referral-program", "view"],
  manage_rules: ["referral-program", "manage"],
  manage_referrers: ["referral-referrers", "manage"],
  manage_settings: ["referral-settings", "manage"],
  refresh: ["referral-statements", "manage"],
  prepare_statement: ["referral-statements", "manage"],
  approve_statement: ["referral-statements", "manage"],
  mark_paid: ["referral-statements", "manage"],
  reverse_entry: ["referral-statements", "manage"],
  clear_review: ["referral-statements", "manage"],
};

/** The area and action a referral action is checked against. Exposed so the action gate can use the same guard as every other page. */
export const registryFor = (action: ReferralAction) => REGISTRY[action];

/** Pages and server actions both ask this, so they cannot disagree. Admin: everything. Finance: everything except rules, referrers and settings. Marketing: the programme view and the rules, nothing named or monetary. */
export function can(role: Role, action: ReferralAction): boolean {
  const [area, act] = REGISTRY[action];
  return registryCan(role, area, act);
}
