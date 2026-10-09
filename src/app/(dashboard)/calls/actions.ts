"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { createTaskIfNotExists } from "@/lib/stage-engine/create-task-if-not-exists";
import { callsReviewEnabled } from "@/lib/calls/flag";
import { canViewCall } from "@/lib/calls/view-model";
import { buildFollowUpTask, followUpSource, validateReviewNote } from "@/lib/calls/follow-up";

export type CallActionResult = { ok: true; message: string } | { ok: false; error: string };

async function loadAuthorizedCall(activityId: string) {
  const session = await requireUser();
  if (!callsReviewEnabled()) return { ok: false, error: "Call review is not enabled." } as const;
  if (!activityId) return { ok: false, error: "Missing call." } as const;
  const scope = await getVisibleUserIds(session.user.id, session.user.role);
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, type: "CALL", client: { isDeleted: false } },
    select: {
      id: true,
      userId: true,
      client: { select: { id: true, name: true, assignedToId: true } },
      conversationReview: { select: { id: true, taskId: true, assignedRmId: true, recommendationText: true, status: true } },
    },
  });
  // Same answer for "does not exist" and "not yours".
  if (!activity || !canViewCall(scope, { rmId: activity.conversationReview?.assignedRmId ?? null, activityUserId: activity.userId, clientAssignedToId: activity.client.assignedToId })) {
    return { ok: false, error: "Call not found." } as const;
  }
  return { ok: true, session, activity } as const;
}

export async function createFollowUpTaskAction(formData: FormData): Promise<CallActionResult> {
  const found = await loadAuthorizedCall(String(formData.get("activityId") ?? ""));
  if (!found.ok) return { ok: false, error: found.error };
  const { session, activity } = found;

  const review = activity.conversationReview;
  const assignedToId = review?.assignedRmId ?? activity.client.assignedToId ?? (session.user.role === "RM" ? session.user.id : null);
  if (!assignedToId) return { ok: false, error: "This customer has no assigned RM to give the task to." };

  const dueRaw = Number(formData.get("dueInDays"));
  const { title, dueAt } = buildFollowUpTask({
    title: String(formData.get("title") ?? ""),
    recommendation: review?.recommendationText,
    customerName: activity.client.name,
    dueInDays: Number.isFinite(dueRaw) && dueRaw > 0 ? dueRaw : 1,
    now: new Date(),
  });

  const task = await createTaskIfNotExists({ clientId: activity.client.id, assignedToId, title, dueAt, source: followUpSource(activity.id) });
  if (review && !review.taskId) {
    // taskId is unique; ignore the (rare) case where this task is already linked to another review.
    await prisma.conversationReview.updateMany({ where: { id: review.id, taskId: null }, data: { taskId: task.id } });
  }

  revalidatePath(`/calls/${activity.id}`);
  revalidatePath("/tasks");
  return { ok: true, message: "Follow-up task created." };
}

export async function markCallReviewedAction(formData: FormData): Promise<CallActionResult> {
  const found = await loadAuthorizedCall(String(formData.get("activityId") ?? ""));
  if (!found.ok) return { ok: false, error: found.error };
  const { session, activity } = found;

  if (session.user.role !== "ADMIN" && session.user.role !== "MANAGER") return { ok: false, error: "Only managers can mark a call reviewed." };
  const review = activity.conversationReview;
  if (!review || review.status !== "ANALYZED") return { ok: false, error: "This call has not been analysed yet." };

  const note = validateReviewNote(String(formData.get("note") ?? ""));
  if (!note.ok) return { ok: false, error: note.error };

  await prisma.conversationReview.update({ where: { id: review.id }, data: { reviewedById: session.user.id, reviewedAt: new Date(), reviewNotes: note.note } });

  revalidatePath(`/calls/${activity.id}`);
  revalidatePath("/calls");
  revalidatePath("/quality-audit");
  return { ok: true, message: "Marked as reviewed." };
}
