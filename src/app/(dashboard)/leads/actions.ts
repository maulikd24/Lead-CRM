"use server";

import { revalidatePath } from "next/cache";

import { correctStageAction } from "@/app/(dashboard)/clients/actions";
import { requireRole } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { prisma } from "@/lib/db/prisma";
import { kanbanEnabled } from "@/lib/leads/kanban-flag";
import { canMoveStages, moveReason, rmMoveVerdict } from "@/lib/leads/kanban-logic";
import { can } from "@/lib/policy/can";
import { moveStageByRm } from "@/lib/stage-engine/transitions";

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

/**
 * An RM moving their OWN lead on the pipeline board. Not the manager stage correction: its own policy rule (`lead:stage_move_own`,
 * own assigned leads only), its own stage check (`rmMoveVerdict`: pre-KYC stages only, never a system-controlled one), its own audit
 * action ("stage_moved_by_rm") and the same stage_changed event as every other stage change. Admin and Manager are refused here and
 * keep `moveLeadStageAction`.
 */
export async function moveOwnLeadStageAction(clientId: string, toStageId: string, undo = false): Promise<MoveLeadResult> {
  if (!kanbanEnabled()) return { ok: false, error: "The pipeline board is not switched on." };
  const session = await requireRole(["RM"]);
  const actor = { id: session.user.id, role: session.user.role };

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, isDeleted: true, status: true, assignedToId: true, currentStageId: true, currentStage: { select: { name: true } }, kycRecord: { select: { id: true } } },
  });
  // An unknown lead and a lead that is not theirs get the same answer.
  if (!client || client.isDeleted) return { ok: false, error: "That lead is no longer available." };
  const decision = await can(actor, "lead:stage_move_own", { type: "client", id: client.id, assignedToId: client.assignedToId });
  if (decision.effect !== "ALLOW") return { ok: false, error: "You can only move a lead assigned to you." };

  const stages = await prisma.stage.findMany({ where: { isActive: true }, select: { id: true, name: true, sequence: true } });
  const toStage = stages.find((s) => s.id === toStageId);
  const verdict = rmMoveVerdict(stages, client.currentStageId, toStageId, { active: client.status === "ACTIVE", hasKycRecord: client.kycRecord !== null });
  if (!verdict.ok || !toStage) return { ok: false, error: verdict.ok ? "That stage is not available." : verdict.error };

  try {
    await moveStageByRm(client.id, toStage.id, moveReason(client.currentStage.name, toStage.name, undo), actor.id);
    revalidatePath("/leads");
    return { ok: true, pendingApproval: false, fromStageId: client.currentStageId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not move the lead." };
  }
}
