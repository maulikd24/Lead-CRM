"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { getAssignmentSettings } from "@/lib/assignment/settings";

const modeSchema = z.enum(["LOAD_BASED", "ROUND_ROBIN", "MANUAL"]);

export async function updateAssignmentModeAction(mode: string) {
  const session = await requireRole(["ADMIN"]);
  const next = modeSchema.parse(mode);
  const current = await getAssignmentSettings();
  if (current.mode === next) return;

  await prisma.$transaction([
    prisma.assignmentSettings.update({
      where: { id: "default" },
      // Restart the rotation fresh whenever the mode changes.
      data: { mode: next, roundRobinCursorId: null, updatedById: session.user.id },
    }),
    prisma.auditLog.create({
      data: {
        userId: session.user.id,
        entity: "AssignmentSettings",
        entityId: "default",
        action: "assignment_mode_changed",
        oldValue: { mode: current.mode },
        newValue: { mode: next },
      },
    }),
  ]);
  revalidatePath("/settings/lead-assignment");
}
