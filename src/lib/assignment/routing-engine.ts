import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Business-defined HNI cutoff for routing purposes — clients at or above this expected
// investment require an RM tagged handlesHni, regardless of the manual clientType field.
const HNI_INVESTMENT_THRESHOLD = 10_000_000; // ₹1 crore

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
  | { assignedToId: null; reason: "no_eligible_rm" };

export function isHniClient(client: AssignmentClientInput): boolean {
  if (client.clientType === "HNI" || client.clientType === "U-HNI") return true;
  if (client.expectedInvestment == null) return false;
  return Number(client.expectedInvestment) >= HNI_INVESTMENT_THRESHOLD;
}

/**
 * Multi-factor routing: eligibility filter (availability, region/language, HNI capability) ->
 * capacity filter -> load-balanced pick (weighted round-robin via least-active-count, which is
 * self-balancing and needs no separate rotating-cursor state).
 */
export async function pickAssignee(client: AssignmentClientInput): Promise<AssignmentResult> {
  const candidates = await prisma.user.findMany({
    where: { isActive: true, availabilityStatus: "AVAILABLE", role: "RM" },
    select: { id: true, name: true, capacity: true, regions: true, languages: true, handlesHni: true },
  });

  const hni = isHniClient(client);

  let eligible = candidates.filter((rm) => {
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

  if (eligible.length === 0) return { assignedToId: null, reason: "no_eligible_rm" };

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

  eligible = eligible.filter(
    (rm) => (countByRmId.get(rm.id) ?? 0) < (rm.capacity ?? DEFAULT_CAPACITY_FALLBACK),
  );
  if (eligible.length === 0) return { assignedToId: null, reason: "no_eligible_rm" };

  eligible.sort((a, b) => (countByRmId.get(a.id) ?? 0) - (countByRmId.get(b.id) ?? 0));
  const chosen = eligible[0];
  return { assignedToId: chosen.id, rmName: chosen.name };
}
