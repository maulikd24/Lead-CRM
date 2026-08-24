"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { logActivity } from "@/lib/activities/log-activity";

const taskSchema = z.object({
  leadId: z.string().min(1),
  title: z.string().min(1, "Title is required"),
  dueAt: z.string().min(1, "Due date is required"),
  assignedToId: z.string().min(1),
});

export async function createTaskAction(formData: FormData) {
  await requireUser();

  const parsed = taskSchema.parse({
    leadId: formData.get("leadId"),
    title: formData.get("title"),
    dueAt: formData.get("dueAt"),
    assignedToId: formData.get("assignedToId"),
  });

  const task = await prisma.task.create({
    data: {
      leadId: parsed.leadId,
      title: parsed.title,
      dueAt: new Date(parsed.dueAt),
      assignedToId: parsed.assignedToId,
      source: "manual",
    },
  });

  revalidatePath("/tasks");
  revalidatePath(`/leads/${parsed.leadId}`);
  return task;
}

export async function completeTaskAction(taskId: string) {
  const session = await requireUser();

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status: "DONE" },
  });

  await logActivity({
    leadId: task.leadId,
    userId: session.user.id,
    type: "TASK_COMPLETED",
    payload: { message: `Completed task: ${task.title}` },
  });

  revalidatePath("/tasks");
  revalidatePath(`/leads/${task.leadId}`);
  return task;
}
