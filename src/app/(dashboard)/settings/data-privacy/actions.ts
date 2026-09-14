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
}
