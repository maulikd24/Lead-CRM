"use server";

import { isAnthropicConfigured, redact } from "@/lib/ai/gateway";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { askTheSystem } from "@/lib/intelligence/ask";
import { answerQuestion, matchIntent, SUPPORTED_QUESTIONS, type AnswerRow } from "@/lib/intelligence/ask-intents";
import { managementScope, type CustomerRow } from "@/lib/intelligence/management";
import { canAskCopilot } from "@/lib/palette/ask-roles";
import { rateLimit } from "@/lib/security/rate-limit";

/**
 * The Co-pilot chat's Ask. Gate and scope come from the policy registry (surface "ask.copilot-chat"): managers and admins get
 * the management scope; an RM gets the same six deterministic intents limited to their own customers (getVisibleUserIds) and
 * to their own tasks for the follow-up count. An RM never reaches the AI loop, which has no RM tool scope. No question or
 * answer is stored. A question is redacted before anything is logged.
 */

export type CopilotAskResponse =
  | { ok: true; answer: string; rows: AnswerRow[]; customers: CustomerRow[]; source: string; asOf: string }
  | { ok: false; reason: "forbidden" | "unsupported" | "error"; message: string; supported: string[] };

const NOT_FOR_YOUR_ROLE = "Ask is not available for your role. Your Co-pilot shows your own priorities above.";

export async function copilotAskAction(question: string): Promise<CopilotAskResponse> {
  const session = await requireAccess("copilot");
  // Refused in the answer, not by redirect, so the Co-pilot page keeps working. No query runs.
  if (!canAskCopilot(session.user.role)) return { ok: false, reason: "forbidden", message: NOT_FOR_YOUR_ROLE, supported: [] };

  const text = question.trim().slice(0, 500);
  if (text.length < 5) {
    return { ok: false, reason: "unsupported", message: "Ask a full question, for example “Which KYC customers have not funded?”", supported: SUPPORTED_QUESTIONS };
  }

  const limited = await rateLimit("ask-system", session.user.id, { limit: 20, windowSeconds: 3600 });
  if (!limited.allowed) return { ok: false, reason: "error", message: "You've asked a lot of questions this hour. Try again shortly.", supported: [] };

  try {
    const visible = await getVisibleUserIds(session.user.id, session.user.role);
    const scope = managementScope(visible, session.user.role === "MANAGER");

    const isRm = session.user.role === "RM";
    if (matchIntent(text)) {
      const found = await answerQuestion(text, scope, new Date(), isRm ? visible : null);
      if (found.ok) return { ok: true, answer: found.answer, rows: found.rows, customers: [], source: found.source, asOf: found.asOf };
    }

    // An RM gets the six questions and nothing else: the AI loop has no RM tool scope, so an unmatched question lists the six.
    if (isRm) return { ok: false, reason: "unsupported", message: "That is not one of the six questions this view can answer. Try one of these:", supported: SUPPORTED_QUESTIONS };
    if (!isAnthropicConfigured()) {
      return {
        ok: false,
        reason: "unsupported",
        message: "That question needs the AI assistant, which is not set up here. These are the questions I can answer from live data:",
        supported: SUPPORTED_QUESTIONS,
      };
    }

    const now = new Date();
    const { answer, customers, tools } = await askTheSystem(text, scope, visible, session.user.role);
    const source = tools.length > 0 ? `AI answer from live data (read-only tools: ${tools.join(", ")})` : "AI answer from live data";
    return { ok: true, answer, rows: [], customers, source, asOf: now.toISOString() };
  } catch (error) {
    // The question may carry a PAN, phone or email: log only its redacted form, and only the error's name.
    console.error("Co-pilot ask failed", redact(text).text, error instanceof Error ? error.name : "unknown");
    return { ok: false, reason: "error", message: "Couldn't answer that right now.", supported: [] };
  }
}
