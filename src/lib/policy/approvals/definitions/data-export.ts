import { prisma } from "@/lib/db/prisma";
import { registerApproval } from "../registry";

type DataExportPayload = { dataExportId: string };

/** How long an approved export stays downloadable. */
export const DATA_EXPORT_VALID_HOURS = 24;

/**
 * Approving opens a 24-hour download window; it never builds or stores the file. The zip is produced on the fly when an
 * Admin downloads it, so no copy of the data sits anywhere waiting to be found.
 */
registerApproval<DataExportPayload>({
  actionType: "DATA_EXPORT",
  entity: "DataExport",
  canRequest: (actor) => actor.role === "ADMIN",
  canDecide: (actor) => actor.role === "ADMIN",
  apply: async (payload) => {
    const approvedAt = new Date();
    const exportRow = await prisma.dataExport.update({
      where: { id: payload.dataExportId },
      data: { approvedAt, expiresAt: new Date(approvedAt.getTime() + DATA_EXPORT_VALID_HOURS * 3_600_000) },
      select: { requestedById: true },
    });
    await prisma.notification.create({
      data: { userId: exportRow.requestedById, type: "data_export_approved", payload: { dataExportId: payload.dataExportId } },
    });
  },
});
