import { prisma } from "@/lib/db/prisma";

import { authoriseMemory, type Viewer } from "./access";
import type { MemoryAction } from "./rules";
import { actOnMemoryItem, editMemoryItem, expireDueMemoryItems, writeMemoryItem, type WriteInput, type WriteResult } from "./store";

const NOT_FOUND: WriteResult = { ok: false, code: "NOT_FOUND", message: "Not found." };

/** Guarded entry points for pages and server actions: authorise against the customer the item belongs to, then call the store. */
async function guard(viewer: Viewer, itemId: string): Promise<{ clientId: string } | null> {
  const item = await prisma.customerMemoryItem.findUnique({ where: { id: itemId }, select: { clientId: true } });
  if (!item) return null;
  const auth = await authoriseMemory(viewer, item.clientId);
  // A viewer who may look but not change gets the same answer as "not found": no oracle for item ids.
  if (!auth.ok || !auth.canManage) return null;
  return { clientId: item.clientId };
}

export async function actOnMemoryAs(viewer: Viewer, itemId: string, action: Omit<MemoryAction, "actorId"> & { reason?: string }, note?: string): Promise<WriteResult> {
  if (!(await guard(viewer, itemId))) return NOT_FOUND;
  return actOnMemoryItem(itemId, { ...action, actorId: viewer.userId } as MemoryAction, { note });
}

export async function editMemoryAs(viewer: Viewer, itemId: string, value: unknown, reason: string): Promise<WriteResult> {
  if (!(await guard(viewer, itemId))) return NOT_FOUND;
  return editMemoryItem(itemId, { value, actorId: viewer.userId, reason });
}

/** An RM records something they know (a fact, a preference, a do-not-do). Source is the RM, so it starts CONFIRMED unless it conflicts. */
export async function recordMemoryAs(viewer: Viewer, input: Omit<WriteInput, "actor" | "sourceType" | "sourceRef" | "evidence" | "observedAt"> & { note: string }): Promise<WriteResult> {
  const auth = await authoriseMemory(viewer, input.clientId);
  if (!auth.ok || !auth.canManage) return NOT_FOUND;
  const now = input.now ?? new Date();
  const type = viewer.role === "ADMIN" ? "ADMIN" : viewer.role === "MANAGER" ? "MANAGER" : "RM";
  return writeMemoryItem({ ...input, actor: { type, userId: viewer.userId }, sourceType: "rm_entry", sourceRef: `user:${viewer.userId}`, evidence: [{ sourceRef: `user:${viewer.userId}`, summary: input.note.trim().slice(0, 280) || "Entered by the RM", observedAt: now }], observedAt: now, now });
}

export { expireDueMemoryItems };
