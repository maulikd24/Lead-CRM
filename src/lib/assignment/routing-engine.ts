import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getAssignmentSettings } from "@/lib/assignment/settings";

// Business-defined HNI cutoff for routing purposes — clients at or above this expected
// investment require an RM tagged handlesHni, regardless of the manual clientType field.
export const HNI_INVESTMENT_THRESHOLD = 10_000_000; // ₹1 crore

// Fallback active-client ceiling when a User has no explicit `capacity` set.
const DEFAULT_CAPACITY_FALLBACK = 50;

export type AssignmentClientInput = {
  clientType?: string | null;
  expectedInvestment?: Prisma.Decimal | number | string | null;
  region?: string | null;
  preferredLanguage?: string | null;
};

export type AssignmentResult =
  | { assignedToId: string; rmName: string }
  | { assignedToId: null; reason: "no_eligible_rm" | "manual_mode" };

export function isHniClient(client: AssignmentClientInput): boolean {
  if (client.clientType === "HNI" || client.clientType === "U-HNI") return true;
  if (client.expectedInvestment == null) return false;
  return Number(client.expectedInvestment) >= HNI_INVESTMENT_THRESHOLD;
}

type EligibleRm = { id: string; name: string; activeCount: number };

/**
 * The eligible pool for a lead, shared by every automatic mode: availability, region/language/HNI
 * constraints, then the capacity ceiling. Each RM comes with their live active-client count.
 */
export async function getEligibleRms(client: AssignmentClientInput): Promise<EligibleRm[]> {
  const candidates = await prisma.user.findMany({
    where: { isActive: true, availabilityStatus: "AVAILABLE", role: "RM" },
    select: { id: true, name: true, capacity: true, regions: true, languages: true, handlesHni: true },
  });

  const hni = isHniClient(client);

  const eligible = candidates.filter((rm) => {
    if (hni && !rm.handlesHni) return false;
    // An RM with no tags configured yet is treated as "no constraint" rather than "matches nothing" —
    // avoids making every RM ineligible before the routing rollout tags everyone.
    if (client.region && rm.regions.length > 0 && !rm.regions.includes(client.region)) return false;
    if (
      client.preferredLanguage &&
      rm.languages.length > 0 &&
      !rm.languages.includes(client.preferredLanguage)
    ) {
      return false;
    }
    return true;
  });
  if (eligible.length === 0) return [];

  const activeCounts = await prisma.client.groupBy({
    by: ["assignedToId"],
    where: {
      assignedToId: { in: eligible.map((rm) => rm.id) },
      status: "ACTIVE",
      mergedIntoId: null,
    },
    _count: { _all: true },
  });
  const countByRmId = new Map(activeCounts.map((row) => [row.assignedToId, row._count._all]));

  return eligible
    .filter((rm) => (countByRmId.get(rm.id) ?? 0) < (rm.capacity ?? DEFAULT_CAPACITY_FALLBACK))
    .map((rm) => ({ id: rm.id, name: rm.name, activeCount: countByRmId.get(rm.id) ?? 0 }));
}

/** Round robin order: stable by id; the next RM is the first one after the cursor, wrapping to the start. */
export function nextInRotation<T extends { id: string }>(pool: T[], cursorId: string | null): T | null {
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => (a.id < b.id ? -1 : 1));
  return (cursorId ? sorted.find((rm) => rm.id > cursorId) : undefined) ?? sorted[0];
}

/**
 * Automatic assignment, driven by the Admin-chosen mode (Settings -> Lead Assignment):
 *  - LOAD_BASED: eligible RM with the fewest active clients (self-balancing, no cursor state).
 *  - ROUND_ROBIN: next eligible RM after the stored cursor; the cursor advances under a row lock so
 *    simultaneous leads can't be handed to the same RM.
 *  - MANUAL: never picks — the caller leaves the lead unassigned and alerts Admins/Managers.
 */
export async function pickAssignee(client: AssignmentClientInput): Promise<AssignmentResult> {
  const settings = await getAssignmentSettings();
  if (settings.mode === "MANUAL") return { assignedToId: null, reason: "manual_mode" };

  const eligible = await getEligibleRms(client);
  if (eligible.length === 0) return { assignedToId: null, reason: "no_eligible_rm" };

  if (settings.mode === "ROUND_ROBIN") {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AssignmentSettings" WHERE id = 'default' FOR UPDATE`;
      const fresh = await tx.assignmentSettings.findUniqueOrThrow({ where: { id: "default" } });
      const chosen = nextInRotation(eligible, fresh.roundRobinCursorId) as EligibleRm;
      await tx.assignmentSettings.update({ where: { id: "default" }, data: { roundRobinCursorId: chosen.id } });
      return { assignedToId: chosen.id, rmName: chosen.name } satisfies AssignmentResult;
    });
  }

  const chosen = [...eligible].sort((a, b) => a.activeCount - b.activeCount)[0];
  return { assignedToId: chosen.id, rmName: chosen.name };
}
