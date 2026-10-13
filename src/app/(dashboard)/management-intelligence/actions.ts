"use server";

import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { answerQuestion, type IntentResponse } from "@/lib/intelligence/ask-intents";
import { managementScope } from "@/lib/intelligence/management";

/** Deterministic Ask: one of six named intents, answered from the same read models as the panels. No AI call. */
export async function answerManagementQuestionAction(question: string): Promise<IntentResponse> {
  const session = await requireAccess("intelligence", "manage");
  const visible = await getVisibleUserIds(session.user.id, session.user.role);
  return answerQuestion(question.slice(0, 500), managementScope(visible, session.user.role === "MANAGER"));
}
