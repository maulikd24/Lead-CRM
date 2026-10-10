"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/require-role";
import { mergeReviewEnabled } from "@/lib/identity/merge-review/flag";
import { syncNextAction } from "@/lib/stage-engine/next-action";
import { decideDismiss, decideMerge, decideReveal } from "@/lib/identity/merge-review/decide";
import { loadComparison, type ComparisonResult } from "@/lib/identity/merge-review/load";
import { decideDeps, revealDeps } from "@/lib/identity/merge-review/wiring";

const OFF = { ok: false as const, code: "FORBIDDEN" as const, error: "Duplicate review is not switched on." };
const enabled = () => mergeReviewEnabled();

export async function getComparisonAction(suggestionId: unknown): Promise<ComparisonResult> {
  const session = await requireUser();
  if (!enabled()) return { ok: false, error: OFF.error };
  if (typeof suggestionId !== "string") return { ok: false, error: "That suggestion could not be found." };
  return loadComparison({ id: session.user.id, role: session.user.role }, suggestionId);
}

/** Merge the duplicate into the chosen survivor. Irreversible, so `confirmed` must be literally true. */
export async function mergeSuggestionAction(suggestionId: unknown, survivorId: unknown, confirmed: unknown) {
  const session = await requireUser();
  if (!enabled()) return OFF;
  const res = await decideMerge(decideDeps(), { id: session.user.id, role: session.user.role }, { suggestionId, survivorId, confirmed });
  if (res.ok) {
    // Same follow-up the Clients merge does: recompute the survivor's next action now that it owns the merged work.
    await syncNextAction(res.survivorId).catch((error) => console.error("syncNextAction after merge failed", error instanceof Error ? error.name : "unknown"));
    revalidatePath("/clients");
    revalidatePath(`/clients/${res.survivorId}`);
  }
  return res.ok ? { ok: true as const, survivorId: res.survivorId, conflicts: res.summary.conflicts } : res;
}

export async function dismissSuggestionAction(suggestionId: unknown, reason?: unknown) {
  const session = await requireUser();
  if (!enabled()) return OFF;
  const res = await decideDismiss(decideDeps(), { id: session.user.id, role: session.user.role }, { suggestionId, reason });
  return res;
}

/** Show one masked field for a moment. Logged to the data-access log before the value is returned. */
export async function revealFieldAction(suggestionId: unknown, side: unknown, field: unknown) {
  const session = await requireUser();
  if (!enabled()) return OFF;
  return decideReveal(revealDeps(), { id: session.user.id, role: session.user.role }, { suggestionId, side, field });
}
