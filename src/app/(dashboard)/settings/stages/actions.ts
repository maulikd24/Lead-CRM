"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";

const updateStageSchema = z.object({
  slaHours: z.coerce.number().int().min(0),
  isActive: z.boolean(),
});

export async function updateStageAction(stageId: string, input: { slaHours: number; isActive: boolean }) {
  await requireRole(["ADMIN"]);

  const parsed = updateStageSchema.parse(input);

  await prisma.stage.update({
    where: { id: stageId },
    data: { slaHours: parsed.slaHours, isActive: parsed.isActive },
  });

  revalidatePath("/settings/stages");
}
