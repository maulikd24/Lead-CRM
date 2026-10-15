import { prisma } from "@/lib/db/prisma";
import { can } from "@/lib/access/policy";
import type { Role } from "@/generated/prisma/client";

/**
 * Cmd+K campaign search: campaign NAMES and the platform only. No spend, no leads, no person. The role check is repeated here (default
 * deny) so the source cannot be queried by a role the registry refuses, whatever the caller does.
 */
export async function searchCampaignNames(role: Role, q: string): Promise<{ name: string; provider: string }[]> {
  if (!can(role, "marketing", "view")) return [];
  const rows = await prisma.adCampaignDaily.findMany({ where: { campaignName: { contains: q, mode: "insensitive" } }, select: { campaignName: true, provider: true }, distinct: ["provider", "campaignName"], take: 4 });
  return rows.map((r) => ({ name: r.campaignName, provider: r.provider }));
}
