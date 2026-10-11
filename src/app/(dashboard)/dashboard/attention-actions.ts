"use server";

import { revalidatePath } from "next/cache";

import { requireAccess } from "@/lib/auth/require-role";
import { setDismissal } from "@/lib/attention/feed";

/** Snooze or dismiss one Needs attention item for the signed-in person. Guarded by the registry (area "attention", action "manage"); the item must be in their own feed, and the override rules apply. Audited. */
export async function setAttentionAction(itemId: string, mode: "dismiss" | "snooze", hours: number, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAccess("attention", "manage");
  if (typeof itemId !== "string" || itemId.length === 0 || itemId.length > 200) return { ok: false, error: "That item is not in your list any more." };
  if (mode !== "dismiss" && mode !== "snooze") return { ok: false, error: "Choose snooze or dismiss." };
  const h = Number(hours);
  const now = new Date();
  const r = await setDismissal({
    userId: session.user.id, role: session.user.role, itemId, status: mode === "dismiss" ? "DISMISSED" : "SNOOZED",
    snoozeUntil: mode === "snooze" && Number.isFinite(h) && h > 0 && h <= 24 * 14 ? new Date(now.getTime() + h * 3_600_000) : null,
    reason: typeof reason === "string" ? reason : null, now,
  });
  if (r.ok) revalidatePath("/dashboard");
  return r;
}
