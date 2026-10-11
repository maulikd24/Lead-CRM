import type { Role } from "@/generated/prisma/client";

/**
 * The ONE gate for every marketing screen: the Marketing workspace, Meta and Google reporting settings, social drafts,
 * referral programme admin, Autopilot, closed-loop conversions, creative, attribution and campaign impact, director
 * reports. Only ADMIN and MARKETING pass. Screens that live on other branches call this same function at merge time;
 * nothing marketing-related may carry its own role list.
 *
 * The registry (policy.ts) agrees with it on every marketing area, and a test keeps the two from drifting.
 */
export function canAccessMarketing(role: Role | string | null | undefined): boolean {
  return role === "ADMIN" || role === "MARKETING";
}
