import { canViewClient } from "@/lib/clients/access";

/**
 * The household privacy wall: a viewer sees only the members they can already open themselves (the Client detail rule, the same one
 * Customer 360 uses). Applied on every household page load, whatever the HOUSEHOLD_INTELLIGENCE_ENABLED flag says: before this, with the
 * flag off a manager could read holdings and transactions of members outside their team just by opening a shared household.
 */
export function wallHouseholdMembers<T extends { client: { assignedToId: string | null } }>(role: string, visibleUserIds: string[] | null, members: readonly T[]): T[] {
  return members.filter((m) => canViewClient(role, visibleUserIds, m.client));
}
