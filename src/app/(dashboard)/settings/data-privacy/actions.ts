"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { requestApproval } from "@/lib/policy/approvals/service";

const createPolicySchema = z.object({
  entity: z.string().min(1),
  retentionDays: z.coerce.number().int().positive(),
  action: z.enum(["ARCHIVE", "ANONYMIZE", "DELETE"]),
});

export async function createRetentionPolicyAction(formData: FormData) {
  await requireRole(["ADMIN"]);
  const parsed = createPolicySchema.parse({
    entity: formData.get("entity"),
    retentionDays: formData.get("retentionDays"),
    action: formData.get("action"),
  });
  await prisma.dataRetentionPolicy.create({ data: parsed });
  revalidatePath("/settings/data-privacy");
}

export async function togglePolicyActiveAction(policyId: string, isActive: boolean) {
  await requireRole(["ADMIN"]);
  await prisma.dataRetentionPolicy.update({ where: { id: policyId }, data: { isActive } });
  revalidatePath("/settings/data-privacy");
}

const createErasureSchema = z.object({
  subjectType: z.enum(["Client", "PartnerProfile"]),
  subjectId: z.string().min(1),
  notes: z.string().optional(),
});

/** Creates the ErasureRequest, then immediately routes it through the maker-checker engine —
 * approving it only flips its status (see erasure-request.ts's definition); it never
 * auto-executes a deletion. */
export async function createErasureRequestAction(formData: FormData) {
  const session = await requireRole(["ADMIN", "FINANCE"]);
  const parsed = createErasureSchema.parse({
    subjectType: formData.get("subjectType"),
    subjectId: formData.get("subjectId"),
    notes: formData.get("notes") || undefined,
  });

  const erasureRequest = await prisma.erasureRequest.create({
    data: { subjectType: parsed.subjectType, subjectId: parsed.subjectId, requestedById: session.user.id, notes: parsed.notes },
  });

  const approvalRequest = await requestApproval(
    "ERASURE_REQUEST",
    { entity: "ErasureRequest", entityId: erasureRequest.id, payload: { erasureRequestId: erasureRequest.id }, reason: parsed.notes },
    { id: session.user.id, role: session.user.role },
  );

  await prisma.erasureRequest.update({ where: { id: erasureRequest.id }, data: { approvalRequestId: approvalRequest.id } });

  revalidatePath("/settings/data-privacy");
  revalidatePath("/settings/approval-workflows");
  if (parsed.subjectType === "Client") revalidatePath(`/clients/${parsed.subjectId}`);
}

/**
 * The step erasure-request.ts's apply() deliberately never does — actually deleting data.
 * Admin-only, and only proceeds once the request has already cleared maker-checker approval.
 * Refuses outright if the client has any financial/regulatory trail (TradingAccount,
 * HouseholdMember, RevenueEvent, AdvisoryInteraction) — that data must never silently disappear
 * or get orphaned; Archive remains the answer for those clients. The safety check re-runs INSIDE
 * the transaction (not just before it), so a race with data added between approval and execution
 * still blocks correctly.
 */
export async function executeClientErasureAction(erasureRequestId: string) {
  const session = await requireRole(["ADMIN"]);

  const erasureRequest = await prisma.erasureRequest.findUniqueOrThrow({ where: { id: erasureRequestId } });
  if (erasureRequest.subjectType !== "Client") throw new Error("Only Client erasure requests can be executed here");
  if (erasureRequest.status !== "APPROVED") throw new Error(`Erasure request is ${erasureRequest.status}, not APPROVED`);

  const clientId = erasureRequest.subjectId;

  await prisma.$transaction(async (tx) => {
    const [tradingAccountCount, householdMemberCount, revenueEventCount, advisoryInteractionCount] = await Promise.all([
      tx.tradingAccount.count({ where: { clientId } }),
      tx.householdMember.count({ where: { clientId } }),
      tx.revenueEvent.count({ where: { clientId } }),
      tx.advisoryInteraction.count({ where: { clientId } }),
    ]);
    if (tradingAccountCount > 0) throw new Error("This client has Trading Accounts on file — use Archive instead of permanent deletion.");
    if (householdMemberCount > 0) throw new Error("This client belongs to a Household — use Archive instead of permanent deletion.");
    if (revenueEventCount > 0) throw new Error("This client has Revenue Events on file — use Archive instead of permanent deletion.");
    if (advisoryInteractionCount > 0) throw new Error("This client has Advisory Interactions on file — use Archive instead of permanent deletion.");

    const client = await tx.client.findUniqueOrThrow({ where: { id: clientId } });

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        entity: "Client",
        entityId: clientId,
        action: "permanently_deleted",
        oldValue: { name: client.name, clientCode: client.clientCode, pan: client.pan, mobile: client.mobile, email: client.email },
        reason: erasureRequest.notes,
      },
    });

    // Delete every Restrict-FK child in dependency order, then the Client row itself.
    await tx.journeyRunStep.deleteMany({ where: { run: { clientId } } });
    await tx.journeyRun.deleteMany({ where: { clientId } });
    await tx.message.deleteMany({ where: { clientId } });
    await tx.document.deleteMany({ where: { clientId } });
    await tx.accountHolder.deleteMany({ where: { clientId } });
    await tx.task.deleteMany({ where: { clientId } });
    await tx.activity.deleteMany({ where: { clientId } });
    await tx.stageHistory.deleteMany({ where: { clientId } });
    await tx.exception.deleteMany({ where: { clientId } });
    await tx.kycRecord.deleteMany({ where: { clientId } });
    await tx.fundingRecord.deleteMany({ where: { clientId } });
    await tx.dealerIntroduction.deleteMany({ where: { clientId } });
    await tx.client.delete({ where: { id: clientId } });

    await tx.erasureRequest.update({ where: { id: erasureRequestId }, data: { status: "COMPLETED", completedAt: new Date() } });
  });

  revalidatePath("/settings/data-privacy");
  revalidatePath("/clients");
}
