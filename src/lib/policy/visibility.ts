import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds as getLegacyVisibleUserIds } from "@/lib/auth/visibility";
import type { Role } from "@/generated/prisma/client";

const LEGACY_ROLES: Role[] = ["ADMIN", "MANAGER", "RM", "DEALER"];

export type VisibilityScope = {
  /** Byte-for-byte identical contract to getVisibleUserIds: null = unrestricted. */
  userIds: string[] | null;
  /** null = not partner-scoped (irrelevant for this actor); [] = scoped but sees no partners. */
  partnerProfileIds: string[] | null;
  teamIds: string[] | null;
};

/**
 * Generalizes the legacy getVisibleUserIds() contract. For the 4 existing roles this delegates
 * to the existing, already-relied-upon function verbatim — zero behavior drift. New roles get
 * new branches only.
 */
export async function getVisibleScope(userId: string, role: Role): Promise<VisibilityScope> {
  if (LEGACY_ROLES.includes(role)) {
    const userIds = await getLegacyVisibleUserIds(userId, role);
    return { userIds, partnerProfileIds: null, teamIds: null };
  }

  const now = new Date();

  if (role === "TEAM_MANAGER") {
    // Two distinct ways a HierarchyAssignment can express "reports to this Team Manager": a
    // direct parentUserId link, OR membership (teamId) in a Team this user manages
    // (Team.teamManagerId) — the seed data and the natural "add someone to my team" flow both use
    // the latter, so both must be honored or a Team Manager's own team appears empty.
    const managedTeams = await prisma.team.findMany({ where: { teamManagerId: userId }, select: { id: true } });
    const managedTeamIds = managedTeams.map((t) => t.id);

    const assignments = await prisma.hierarchyAssignment.findMany({
      where: {
        AND: [
          { OR: [{ parentUserId: userId }, ...(managedTeamIds.length ? [{ teamId: { in: managedTeamIds } }] : [])] },
          { validFrom: { lte: now } },
          { OR: [{ validTo: null }, { validTo: { gt: now } }] },
        ],
      },
      select: { assigneeUserId: true, assigneePartnerId: true, teamId: true },
    });
    const userIds = [userId, ...assignments.map((a) => a.assigneeUserId).filter((x): x is string => !!x)];
    const partnerIds = assignments.map((a) => a.assigneePartnerId).filter((x): x is string => !!x);
    const teamIds = [...new Set([...managedTeamIds, ...assignments.map((a) => a.teamId).filter((x): x is string => !!x)])];
    return {
      userIds,
      partnerProfileIds: partnerIds.length ? partnerIds : null,
      teamIds: teamIds.length ? teamIds : null,
    };
  }

  if (role === "PARTNER" || role === "AFFILIATE" || role === "DISTRIBUTOR") {
    const profile = await prisma.partnerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) return { userIds: [userId], partnerProfileIds: [], teamIds: null };

    const subPartnerIds = role === "DISTRIBUTOR" ? await getDescendantPartnerProfileIds(profile.id) : [];
    return { userIds: [userId], partnerProfileIds: [profile.id, ...subPartnerIds], teamIds: null };
  }

  if (role === "FINANCE") {
    // Finance reconciles payouts/commissions across all partners, but must never be granted
    // client-row visibility through this path — Finance-facing queries should join through
    // partnerProfileIds only, never userIds/assignedToId.
    return { userIds: null, partnerProfileIds: null, teamIds: null };
  }

  // Fail-closed default for any future role added without updating this function.
  return { userIds: [userId], partnerProfileIds: null, teamIds: null };
}

async function getDescendantPartnerProfileIds(rootId: string): Promise<string[]> {
  const children = await prisma.partnerProfile.findMany({
    where: { parentPartnerProfileId: rootId },
    select: { id: true },
  });
  const nested = await Promise.all(children.map((c) => getDescendantPartnerProfileIds(c.id)));
  return [...children.map((c) => c.id), ...nested.flat()];
}

/** Re-exported for new callsites — identical contract to @/lib/auth/visibility's function. */
export { getLegacyVisibleUserIds as getVisibleUserIds };
