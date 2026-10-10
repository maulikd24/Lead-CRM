import type { Role } from "@/generated/prisma/client";

export type ReferralAction = "view" | "manage_rules" | "manage_referrers" | "manage_settings" | "refresh" | "prepare_statement" | "approve_statement" | "mark_paid" | "reverse_entry" | "clear_review";

const ADMIN_ONLY: ReferralAction[] = ["manage_rules", "manage_referrers", "manage_settings"];

/** The one authorisation table for the programme. Pages and server actions both ask it, so they cannot disagree. */
export function can(role: Role, action: ReferralAction): boolean {
  if (role === "ADMIN") return true;
  if (role === "FINANCE") return !ADMIN_ONLY.includes(action);
  return false;
}
