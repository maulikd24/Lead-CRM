"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/require-role";
import { ApprovalBlockedError, decideApproval } from "@/lib/policy/approvals/service";
import type { ApprovalActionType, ApprovalDecisionOptions } from "@/lib/policy/approvals/registry";

export type DecideResult = { ok: true } | { ok: false; message: string; blocked: string[] };

/**
 * Admin decides a pending request. An approval that the rules block (a payout run with a suspended partner or an unverified bank)
 * comes back as a plain result with the reasons, so the screen can ask for an override reason and try again.
 */
export async function decideApprovalAction(approvalRequestId: string, decision: "APPROVED" | "REJECTED", decisionNote?: string, options?: ApprovalDecisionOptions): Promise<DecideResult> {
  const session = await requireRole(["ADMIN"]);
  try {
    await decideApproval(approvalRequestId, decision, decisionNote, { id: session.user.id, role: session.user.role }, options);
  } catch (e) {
    if (e instanceof ApprovalBlockedError) return { ok: false, message: e.message, blocked: e.reasons };
    throw e;
  }
  revalidatePath("/settings/approval-workflows");
  revalidatePath("/finance-console");
  return { ok: true };
}

export type { ApprovalActionType };
