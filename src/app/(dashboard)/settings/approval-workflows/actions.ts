"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { decideApproval } from "@/lib/policy/approvals/service";
import type { ApprovalActionType } from "@/lib/policy/approvals/registry";

export async function decideApprovalAction(approvalRequestId: string, decision: "APPROVED" | "REJECTED", decisionNote?: string) {
  const session = await requireRole(["ADMIN"]);
  await decideApproval(approvalRequestId, decision, decisionNote, { id: session.user.id, role: session.user.role });
  revalidatePath("/settings/approval-workflows");
  revalidatePath("/finance-console");
}

export type { ApprovalActionType };
