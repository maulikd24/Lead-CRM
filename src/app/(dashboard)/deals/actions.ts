"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";

const dealSchema = z.object({
  title: z.string().min(1, "Title is required"),
  value: z.coerce.number().min(0),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  leadId: z.string().optional().or(z.literal("")),
});

export async function createDealAction(formData: FormData) {
  await requireUser();

  const parsed = dealSchema.parse({
    title: formData.get("title"),
    value: formData.get("value"),
    pipelineId: formData.get("pipelineId"),
    stageId: formData.get("stageId"),
    leadId: formData.get("leadId"),
  });

  const deal = await prisma.deal.create({
    data: {
      title: parsed.title,
      value: parsed.value,
      pipelineId: parsed.pipelineId,
      stageId: parsed.stageId,
      leadId: parsed.leadId || null,
    },
  });

  revalidatePath("/deals");
  return { id: deal.id };
}

export async function moveDealStageAction(dealId: string, stageId: string) {
  await requireUser();

  const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { id: stageId } });
  const isTerminal = stage.name === "Won" || stage.name === "Lost";

  await prisma.deal.update({
    where: { id: dealId },
    data: { stageId, closedAt: isTerminal ? new Date() : null },
  });

  revalidatePath("/deals");
}
