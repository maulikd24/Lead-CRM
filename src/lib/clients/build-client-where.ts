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
  leadSource?: string;
  createdFrom?: string;
  createdTo?: string;
};

/** Shared filter-building logic for the /clients list page and the CSV export route. */
export function buildClientWhere(params: ClientFilterParams, visibleUserIds: string[] | null): Prisma.ClientWhereInput {
  let assignedToFilter: Prisma.ClientWhereInput["assignedToId"];
  if (params.rm && (!visibleUserIds || visibleUserIds.includes(params.rm))) {
    assignedToFilter = params.rm;
  } else if (visibleUserIds) {
    assignedToFilter = { in: visibleUserIds };
  }

  return {
    ...(assignedToFilter !== undefined ? { assignedToId: assignedToFilter } : {}),
    ...(params.stage ? { currentStageId: params.stage } : {}),
    ...(params.priority ? { priority: params.priority as Prisma.ClientWhereInput["priority"] } : {}),
    ...(params.status ? { status: params.status as Prisma.ClientWhereInput["status"] } : {}),
    ...(params.kyc ? { kycRecord: { status: params.kyc as never } } : {}),
    ...(params.funding ? { fundingRecord: { status: params.funding as never } } : {}),
    ...(params.dealer ? { dealerIntroduction: { status: params.dealer as never } } : {}),
    ...(params.clientType ? { clientType: params.clientType } : {}),
    ...(params.leadSource ? { leadSource: params.leadSource } : {}),
    ...(params.createdFrom || params.createdTo
      ? {
          createdAt: {
            ...(params.createdFrom ? { gte: new Date(params.createdFrom) } : {}),
            ...(params.createdTo ? { lte: new Date(`${params.createdTo}T23:59:59.999`) } : {}),
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
