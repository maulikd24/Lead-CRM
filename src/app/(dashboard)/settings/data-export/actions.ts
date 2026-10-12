"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { requestApproval } from "@/lib/policy/approvals/service";

const requestSchema = z.object({ reason: z.string().trim().min(10, "Give a reason of at least 10 characters").max(500) });

/**
 * An Admin asks to export every client and their full history. Nothing is built here — the request goes to the
 * maker-checker queue, and a second Admin has to approve it before the requester can download anything.
 */
export async function requestDataExportAction(formData: FormData) {
  const session = await requireRole(["ADMIN"]);
  const { reason } = requestSchema.parse({ reason: formData.get("reason") });
  const actor = { id: session.user.id, role: session.user.role };

  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true, id: { not: actor.id } }, select: { id: true } });
  if (admins.length === 0) throw new Error("A second active Admin is needed to approve an export — there isn't one.");

  // One open request at a time keeps the approval queue honest.
  const open = await prisma.dataExport.findFirst({
    where: { requestedById: actor.id, OR: [{ approvedAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: "desc" },
  });
  if (open) {
    const approval = open.approvalRequestId ? await prisma.approvalRequest.findUnique({ where: { id: open.approvalRequestId }, select: { status: true } }) : null;
    if (!approval || approval.status === "PENDING" || (approval.status === "APPROVED" && open.expiresAt && open.expiresAt > new Date())) {
      throw new Error("You already have an export waiting for approval or ready to download.");
    }
  }

  const dataExport = await prisma.dataExport.create({ data: { requestedById: actor.id, reason } });
  const approval = await requestApproval("DATA_EXPORT", { entity: "DataExport", entityId: dataExport.id, payload: { dataExportId: dataExport.id }, reason }, actor);
  await prisma.dataExport.update({ where: { id: dataExport.id }, data: { approvalRequestId: approval.id } });

  await prisma.auditLog.create({
    data: { userId: actor.id, entity: "DataExport", entityId: dataExport.id, action: "data_export_requested", reason, newValue: { approvalRequestId: approval.id } },
  });
  await Promise.all(
    admins.map((admin) =>
      prisma.notification.create({ data: { userId: admin.id, type: "data_export_requested", payload: { dataExportId: dataExport.id, requesterName: session.user.name, reason } } }),
    ),
  );

  revalidatePath("/settings/data-export");
  revalidatePath("/settings/approval-workflows");
}
