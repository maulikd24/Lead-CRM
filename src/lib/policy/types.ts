import type { Role } from "@/generated/prisma/client";

export type Actor = { id: string; role: Role };

export type PolicyAction =
  | "client:view"
  | "client:edit"
  | "client:reassign"
  | "client:merge"
  | "client:stage_override"
  | "partner:view"
  | "partner:edit"
  | "partner:tier_change"
  | "commission:view"
  | "commission:adjust"
  | "payout:approve";

export type PolicyResource =
  | { type: "client"; id: string; assignedToId: string | null }
  | { type: "partner"; id: string; userId: string; parentPartnerProfileId?: string | null }
  | { type: "payout"; id: string; partnerProfileId: string };

export type PolicyEffect = "ALLOW" | "REQUIRE_APPROVAL" | "DENY";

export type Decision = { effect: PolicyEffect; reason: string };
