import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { apiGuard } from "@/lib/access/api-guard";
import { logExport } from "@/lib/activity/log-user-event";
import { createExportStream } from "@/lib/data-export/stream";
import { MAX_DOWNLOADS } from "@/lib/data-export/limits";

// Building the zip streams straight from the database to the browser; a very large database may need longer than one
// request allows — the Data Export page tells the Admin to use pg_dump in that case.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("settings-data-privacy", "export");
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const { id } = await params;
  const exportRow = await prisma.dataExport.findUnique({ where: { id }, include: { requestedBy: { select: { name: true, email: true } } } });
  if (!exportRow || exportRow.requestedById !== session.user.id) return refuse(404, "Export not found");

  const approval = exportRow.approvalRequestId
    ? await prisma.approvalRequest.findUnique({ where: { id: exportRow.approvalRequestId }, select: { status: true, decidedBy: { select: { name: true, email: true } } } })
    : null;
  if (approval?.status === "REJECTED") return refuse(409, "This export request was rejected");
  if (!approval || approval.status !== "APPROVED" || !exportRow.approvedAt) return refuse(409, "This export has not been approved yet");

  // Claim a download atomically so two parallel requests can't both pass the limit.
  const now = new Date();
  const claimed = await prisma.dataExport.updateMany({
    where: { id, approvedAt: { not: null }, expiresAt: { gt: now }, downloadCount: { lt: MAX_DOWNLOADS } },
    data: { downloadCount: { increment: 1 }, lastDownloadedAt: now },
  });
  if (claimed.count === 0) return refuse(410, exportRow.expiresAt && exportRow.expiresAt <= now ? "This export has expired — request a new one" : "The download limit for this export is used up — request a new one");

  const exportedAt = new Date();
  const { stream, done } = createExportStream({
    exportId: id,
    exportedAt,
    requestedBy: exportRow.requestedBy,
    approvedBy: approval.decidedBy,
    reason: exportRow.reason,
  });

  await prisma.auditLog.create({
    data: { userId: session.user.id, entity: "DataExport", entityId: id, action: "data_export_downloaded", reason: exportRow.reason, newValue: { downloadNumber: exportRow.downloadCount + 1 } },
  });
  void logExport(session.user, `/api/data-export/${id}/download`, "Downloaded full data export");

  void done
    .then((result) => prisma.dataExport.update({ where: { id }, data: { rowCounts: result.rowCounts } }))
    .catch(async (error) => {
      console.error("Data export failed", error);
      // The download never completed, so it shouldn't count against the limit.
      await prisma.dataExport.update({ where: { id }, data: { downloadCount: { decrement: 1 } } }).catch(() => {});
    });

  const stamp = exportedAt.toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="supportify-export-${stamp}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
