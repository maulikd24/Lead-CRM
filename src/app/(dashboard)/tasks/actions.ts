"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";
import { getAdapter } from "@/lib/integrations/registry";

const taskSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().min(1, "Title is required"),
  dueAt: z.string().min(1, "Due date is required"),
  assignedToId: z.string().min(1),
  source: z.string().min(1).optional(),
  createClickUpTask: z.string().optional(),
});

export async function createTaskAction(formData: FormData) {
  await requireUser();

  const parsed = taskSchema.parse({
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    dueAt: formData.get("dueAt"),
    assignedToId: formData.get("assignedToId"),
    source: formData.get("source") || undefined,
    createClickUpTask: formData.get("createClickUpTask") || undefined,
  });

  const task = await prisma.task.create({
    data: {
      clientId: parsed.clientId,
      title: parsed.title,
      dueAt: new Date(parsed.dueAt),
      assignedToId: parsed.assignedToId,
      source: parsed.source ?? "manual",
    },
  });

  let clickUpError: string | undefined;
  if (parsed.createClickUpTask === "on") {
    const client = await prisma.client.findUnique({ where: { id: parsed.clientId } });
    if (client) {
      const adapter = await getAdapter("clickup");
      const result = await adapter.actions.createTask(client, { title: parsed.title, dueAt: parsed.dueAt });
      if (result.success && result.data) {
        const data = result.data as { id?: string; url?: string };
        await prisma.task.update({
          where: { id: task.id },
          data: { externalProvider: "clickup", externalId: data.id, externalUrl: data.url },
        });
      } else {
        clickUpError = result.error ?? "Failed to create ClickUp task";
      }
    }
  }

  revalidatePath("/tasks");
  revalidatePath(`/clients/${parsed.clientId}`);
  revalidatePath("/copilot");
  return { ...task, clickUpError };
}

export async function completeTaskAction(taskId: string) {
  const session = await requireUser();

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status: "DONE" },
  });

  await logActivity({
    clientId: task.clientId,
    userId: session.user.id,
    type: "TASK_COMPLETED",
    payload: { message: `Completed task: ${task.title}` },
  });

  revalidatePath("/tasks");
  revalidatePath(`/clients/${task.clientId}`);
  return task;
}
