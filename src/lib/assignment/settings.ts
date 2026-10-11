import { prisma } from "@/lib/db/prisma";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/**
 * The singleton settings row; created with defaults (LOAD_BASED) on first read so existing behaviour never changes silently.
 * Two concurrent first reads on an empty table can both miss and both insert; the loser gets P2002 on id.
 * The row exists by then, so re-read it instead of failing the request.
 */
export async function getAssignmentSettings() {
  try {
    return await prisma.assignmentSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return prisma.assignmentSettings.findUniqueOrThrow({ where: { id: "default" } });
  }
}
