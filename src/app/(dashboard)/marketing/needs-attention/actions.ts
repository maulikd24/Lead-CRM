"use server";

import { revalidatePath } from "next/cache";

import { setDismissal } from "@/lib/attention/feed";
import { requireMarketing } from "@/lib/auth/require-role";
import { campaignAttentionSource } from "@/lib/marketing/campaign-attention";

/** Snooze or dismiss a campaign anomaly for the signed-in marketing person (or an admin). Registry area "attention-marketing", action "manage". Audited. */
export async function setCampaignAttentionAction(itemId: string, mode: "dismiss" | "snooze", hours: number, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireMarketing("attention-marketing", "manage");
  if (typeof itemId !== "string" || itemId.length === 0 || itemId.length > 200) return { ok: false, error: "That item is not in your list any more." };
  if (mode !== "dismiss" && mode !== "snooze") return { ok: false, error: "Choose snooze or dismiss." };
  const h = Number(hours);
  const now = new Date();
  const r = await setDismissal({
    userId: session.user.id, role: session.user.role, itemId, status: mode === "dismiss" ? "DISMISSED" : "SNOOZED",
    snoozeUntil: mode === "snooze" && Number.isFinite(h) && h > 0 && h <= 24 * 14 ? new Date(now.getTime() + h * 3_600_000) : null,
    reason: typeof reason === "string" ? reason : null, now, extraSources: [campaignAttentionSource],
  });
  if (r.ok) revalidatePath("/marketing/needs-attention");
  return r;
}
