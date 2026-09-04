"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";
import type { DealerIntroStatus } from "@/generated/prisma/client";

/**
 * Dealer self-service: intentionally narrow. Only status/remarks/completion can be updated
 * here — portfolio preferences and trading limits are set by the RM/Manager at handoff time
 * (via recordDealerIntroductionAction) and are not part of this action's input type at all.
 */
export async function updateDealerHandoffStatusAction(
  dealerIntroductionId: string,
  input: { status: DealerIntroStatus; remarks?: string },
) {
  const session = await requireRole(["DEALER"]);

  const record = await prisma.dealerIntroduction.findUnique({ where: { id: dealerIntroductionId } });
  if (!record || record.dealerId !== session.user.id) {
    throw new Error("Not authorized to update this handoff");
  }

  await prisma.dealerIntroduction.update({
    where: { id: dealerIntroductionId },
    data: {
      status: input.status,
      remarks: input.remarks,
      completedDate: input.status === "COMPLETED" ? new Date() : record.completedDate,
    },
  });

  await logActivity({
    clientId: record.clientId,
    userId: session.user.id,
    type: "NOTE",
    payload: { message: `Dealer updated handoff status: ${input.status}` },
  });

  await prisma.auditLog.create({
    data: {
      userId: session.user.id,
      entity: "DealerIntroduction",
      entityId: record.id,
      action: "dealer_self_update",
      oldValue: { status: record.status },
      newValue: { status: input.status },
    },
  });

  revalidatePath("/dealer-desk");
}
