"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { applyFeedback, type FeedbackResult } from "@/lib/intelligence/decision/feedback-db";
import type { UserFeedback } from "@/lib/intelligence/decision/feedback";

/**
 * Feedback on a decision: Accept, Done, Snooze, Wrong, Not now, Do not recommend. Registry area "decision-drawer" (managers and RMs); the
 * per-customer rule (an RM only for their own customers, only while NBA_RM_VISIBLE is on, never marketing) is enforced inside applyFeedback.
 * Accept creates a Task. Nothing here sends a message.
 */
const payload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accept") }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("snooze"), days: z.number().int() }),
  z.object({ kind: z.literal("wrong"), reason: z.string().max(40) }),
  z.object({ kind: z.literal("not_now"), until: z.string().max(40) }),
  z.object({ kind: z.literal("dnr"), reason: z.string().max(40), days: z.number().int().min(1).max(730).optional() }),
]);

export async function submitDecisionFeedbackAction(decisionId: string, raw: unknown): Promise<FeedbackResult> {
  const session = await requireAccess("decision-drawer", "manage");
  const parsed = payload.safeParse(raw);
  if (typeof decisionId !== "string" || decisionId.length === 0 || decisionId.length > 64 || !parsed.success) return { ok: false, error: "That request was not understood." };
  const p = parsed.data;
  let feedback: UserFeedback;
  switch (p.kind) {
    case "accept":
    case "done":
      feedback = { kind: p.kind };
      break;
    case "snooze":
      feedback = { kind: "snooze", days: p.days };
      break;
    case "wrong":
      feedback = { kind: "wrong", reason: p.reason };
      break;
    case "not_now":
      feedback = { kind: "not_now", until: new Date(p.until) };
      break;
    case "dnr":
      feedback = { kind: "dnr", reason: p.reason, ...(p.days ? { until: new Date(Date.now() + p.days * 86_400_000) } : {}) };
      break;
  }
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role);
  const result = await applyFeedback({ decisionId, viewer: { id: session.user.id, role: session.user.role }, visibleUserIds, feedback });
  if (result.ok) {
    revalidatePath("/decisions");
    revalidatePath("/clients");
  }
  return result;
}
