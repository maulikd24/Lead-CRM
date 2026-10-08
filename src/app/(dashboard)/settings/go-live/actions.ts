"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { ITEM_BY_ID } from "@/lib/go-live/items";

/** Tick or untick a manual checklist item (Admin only). Automatic items can't be set by hand. */
export async function setGoLiveCheckAction(itemId: string, done: boolean, note?: string) {
  const session = await requireRole(["ADMIN"]);
  const item = ITEM_BY_ID.get(itemId);
  if (!item) throw new Error("Unknown checklist item");
  if (item.kind !== "manual") throw new Error("This item is checked automatically");

  const cleanNote = note?.trim().slice(0, 500) || null;
  await prisma.goLiveCheck.upsert({
    where: { itemId },
    update: { done, note: cleanNote, doneById: done ? session.user.id : null, doneAt: done ? new Date() : null },
    create: { itemId, done, note: cleanNote, doneById: done ? session.user.id : null, doneAt: done ? new Date() : null },
  });
  revalidatePath("/settings/go-live");
}
