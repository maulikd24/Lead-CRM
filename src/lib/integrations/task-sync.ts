import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import type { TaskStatus } from "@/generated/prisma/client";
import type { NormalizedEvent } from "@/lib/integrations/types";

/**
 * Simple heuristic, not a configurable per-workspace mapping (same style as
 * src/lib/copilot/cross-sell.ts) — "done"/"complete"/"closed" anywhere in the
 * raw status string means DONE, everything else stays PENDING.
 */
export function mapExternalStatus(raw: string): TaskStatus {
  const normalized = raw.toLowerCase();
  if (normalized.includes("done") || normalized.includes("complete") || normalized.includes("closed")) {
    return "DONE";
  }
  return "PENDING";
}

async function notifyAndLog(params: {
  provider: string;
  taskId: string;
  taskTitle: string;
  clientId: string;
  assignedToId: string;
  newStatus: TaskStatus;
  rawStatus: string;
  clientName: string;
}) {
  await logActivity({
    clientId: params.clientId,
    userId: params.assignedToId,
    type: "TICKET",
    payload: {
      source: params.provider,
      taskId: params.taskId,
      taskTitle: params.taskTitle,
      newStatus: params.newStatus,
      rawStatus: params.rawStatus,
    },
  });

  await prisma.notification.create({
    data: {
      userId: params.assignedToId,
      type: "external_task_status_changed",
      payload: {
        clientId: params.clientId,
        clientName: params.clientName,
        taskId: params.taskId,
        taskTitle: params.taskTitle,
        provider: params.provider,
        newStatus: params.newStatus,
      },
    },
  });
}

/**
 * Routes an inbound webhook event that identifies an external task/issue
 * (ClickUp task, Jira issue) to the Supportify Task it's linked to, or —
 * for providers like Jira where the ticket wasn't created via Supportify —
 * creates a new linked Task the first time we see it (via NormalizedEvent.clientCode).
 * Unmatched events are silently dropped, matching the existing client-phone/email
 * matching precedent in the webhook route (no error surfaced, no retry).
 */
export async function handleExternalTaskEvent(provider: string, event: NormalizedEvent): Promise<void> {
  if (!event.externalTaskId) return;

  const newStatus = mapExternalStatus(String((event.payload as { status?: unknown }).status ?? ""));

  const existing = await prisma.task.findFirst({
    where: { externalProvider: provider, externalId: event.externalTaskId },
    include: { client: { select: { id: true, name: true } } },
  });

  if (existing) {
    if (existing.status === newStatus) return; // already at target status — no-op (idempotency/loop guard)

    await prisma.task.update({ where: { id: existing.id }, data: { status: newStatus } });
    await notifyAndLog({
      provider,
      taskId: existing.id,
      taskTitle: existing.title,
      clientId: existing.clientId,
      assignedToId: existing.assignedToId,
      newStatus,
      rawStatus: String((event.payload as { rawStatus?: unknown }).rawStatus ?? ""),
      clientName: existing.client.name,
    });
    return;
  }

  if (!event.clientCode) return;

  const client = await prisma.client.findUnique({ where: { clientCode: event.clientCode } });
  if (!client || !client.assignedToId) return; // no client match, or no RM to assign the task to

  const title = String((event.payload as { title?: unknown }).title ?? `${provider} ${event.externalTaskId}`);

  const task = await prisma.task.create({
    data: {
      clientId: client.id,
      assignedToId: client.assignedToId,
      title,
      dueAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      status: newStatus,
      source: provider,
      externalProvider: provider,
      externalId: event.externalTaskId,
    },
  });

  await notifyAndLog({
    provider,
    taskId: task.id,
    taskTitle: task.title,
    clientId: client.id,
    assignedToId: client.assignedToId,
    newStatus,
    rawStatus: String((event.payload as { rawStatus?: unknown }).rawStatus ?? ""),
    clientName: client.name,
  });
}
