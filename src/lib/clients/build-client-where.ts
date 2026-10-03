import type { Prisma } from "@/generated/prisma/client";

export type ClientFilterParams = {
  q?: string;
  stage?: string;
  priority?: string;
  status?: string;
  rm?: string;
  kyc?: string;
  funding?: string;
  dealer?: string;
  clientType?: string;
  investmentCategory?: string;
  leadSource?: string;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  archived?: string;
};

/** Shared filter-building logic for the /clients list page and the CSV export route. */
export const UNASSIGNED_RM_FILTER = "unassigned";

/**
 * `includeUnassigned` lets a scoped caller (Managers) also see leads nobody owns yet — they are the ones who
 * assign them (Lead Assignment "Manual" mode, or no eligible RM). Admins (visibleUserIds = null) already see
 * everything; RMs never get this. Without it a scoped caller sees only their visible users' clients.
 */
export function buildClientWhere(
  params: ClientFilterParams,
  visibleUserIds: string[] | null,
  options: { includeUnassigned?: boolean } = {},
): Prisma.ClientWhereInput {
  const canSeeUnassigned = visibleUserIds === null || !!options.includeUnassigned;
  let assignedToFilter: Prisma.ClientWhereInput["assignedToId"];
  let scopeWithUnassigned = false;
  if (params.rm === UNASSIGNED_RM_FILTER && canSeeUnassigned) {
    assignedToFilter = null;
  } else if (params.rm && (!visibleUserIds || visibleUserIds.includes(params.rm))) {
    assignedToFilter = params.rm;
  } else if (visibleUserIds) {
    if (options.includeUnassigned) scopeWithUnassigned = true;
    else assignedToFilter = { in: visibleUserIds };
  }

  return {
    isDeleted: params.archived === "true",
    ...(assignedToFilter !== undefined ? { assignedToId: assignedToFilter } : {}),
    ...(scopeWithUnassigned && visibleUserIds ? { AND: [{ OR: [{ assignedToId: { in: visibleUserIds } }, { assignedToId: null }] }] } : {}),
    ...(params.stage ? { currentStageId: params.stage } : {}),
    ...(params.priority ? { priority: params.priority as Prisma.ClientWhereInput["priority"] } : {}),
    ...(params.status ? { status: params.status as Prisma.ClientWhereInput["status"] } : {}),
    ...(params.kyc ? { kycRecord: { status: params.kyc as never } } : {}),
    ...(params.funding ? { fundingRecord: { status: params.funding as never } } : {}),
    ...(params.dealer ? { dealerIntroduction: { status: params.dealer as never } } : {}),
    ...(params.clientType ? { clientType: params.clientType } : {}),
    ...(params.investmentCategory ? { investmentCategory: params.investmentCategory } : {}),
    ...(params.leadSource ? { leadSource: params.leadSource } : {}),
    ...(params.createdFrom || params.createdTo
      ? {
          createdAt: {
            ...(params.createdFrom ? { gte: new Date(params.createdFrom) } : {}),
            ...(params.createdTo ? { lte: new Date(`${params.createdTo}T23:59:59.999`) } : {}),
          },
        }
      : {}),
    ...(params.updatedFrom || params.updatedTo
      ? {
          updatedAt: {
            ...(params.updatedFrom ? { gte: new Date(params.updatedFrom) } : {}),
            ...(params.updatedTo ? { lte: new Date(`${params.updatedTo}T23:59:59.999`) } : {}),
          },
        }
      : {}),
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { mobile: { contains: params.q, mode: "insensitive" } },
            { email: { contains: params.q, mode: "insensitive" } },
            { clientCode: { contains: params.q, mode: "insensitive" } },
            { kycRecord: { referenceNumber: { contains: params.q, mode: "insensitive" } } },
            { dealerIntroduction: { dealerId: { contains: params.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}
