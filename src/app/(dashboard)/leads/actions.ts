"use server";

import { revalidatePath } from "next/cache";

import { correctStageAction } from "@/app/(dashboard)/clients/actions";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";
import { kanbanEnabled } from "@/lib/leads/kanban-flag";
import { canMoveStages, moveReason } from "@/lib/leads/kanban-logic";

export type MoveLeadResult = { ok: true; pendingApproval: boolean; fromStageId: string } | { ok: false; error: string };

/**
 * Moves a lead to another stage from the pipeline board. This is the REAL stage correction (`correctStageAction`): the same role gate
 * (Admin and Manager), the same policy check and approval flow, the same stage history and audit entry (action "stage_corrected", with
 * the reason below). The board adds only two things: it refuses a customer outside the person's own scope, and it writes the reason
 * itself from the two stage names, so a drag is never an unexplained change. `undo` marks the reverse move behind the Undo toast.
 */
export async function moveLeadStageAction(clientId: string, toStageId: string, undo = false): Promise<MoveLeadResult> {
  if (!kanbanEnabled()) return { ok: false, error: "The pipeline board is not switched on." };
  const session = await requireRole(["ADMIN", "MANAGER"]);
  if (!canMoveStages(session.user.role)) return { ok: false, error: "Only managers and admins can move a stage." };

  const [visible, client, toStage] = await Promise.all([
    getVisibleUserIds(session.user.id, session.user.role),
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true, isDeleted: true, assignedToId: true, currentStageId: true, currentStage: { select: { name: true } } } }),
    prisma.stage.findUnique({ where: { id: toStageId }, select: { id: true, name: true, isActive: true } }),
  ]);
  if (!client || client.isDeleted || !toStage || !toStage.isActive) return { ok: false, error: "That lead or stage is no longer available." };
  // Same visibility as the Clients list: an admin sees all; a manager sees their team and the unassigned pool.
  const inScope = visible === null || (client.assignedToId ? visible.includes(client.assignedToId) : session.user.role === "MANAGER");
  if (!inScope) return { ok: false, error: "That lead is outside your team." };
  if (client.currentStageId === toStage.id) return { ok: true, pendingApproval: false, fromStageId: client.currentStageId };

  try {
    const { pendingApproval } = await correctStageAction(client.id, toStage.id, moveReason(client.currentStage.name, toStage.name, undo));
    revalidatePath("/leads");
    return { ok: true, pendingApproval, fromStageId: client.currentStageId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not move the lead." };
  }
}
