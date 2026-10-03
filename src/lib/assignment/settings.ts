import { prisma } from "@/lib/db/prisma";

/** The singleton settings row; created with defaults (LOAD_BASED) on first read so existing behaviour never changes silently. */
export async function getAssignmentSettings() {
  return prisma.assignmentSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
}
