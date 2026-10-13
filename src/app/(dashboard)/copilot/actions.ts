"use server";

import { isAnthropicConfigured, redact } from "@/lib/ai/gateway";
import { requireAccess } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { askTheSystem } from "@/lib/intelligence/ask";
import { answerQuestion, matchIntent, SUPPORTED_QUESTIONS, type AnswerRow } from "@/lib/intelligence/ask-intents";
import { managementScope, type CustomerRow } from "@/lib/intelligence/management";
import { canAsk } from "@/lib/palette/ask-roles";
import { rateLimit } from "@/lib/security/rate-limit";

/**
 * The Co-pilot chat's Ask. Same rules as Ask the system on Customer Intelligence: the same role gate (managers and admins,
 * from the policy registry), the same customer scope, the same six deterministic intents, then the same AI loop
 * (intelligence_ask, purpose ask.intelligence, read-only tools) only when no intent matches and an AI key is set.
 * No question or answer is stored. A question is redacted before anything is logged.
 */

export type CopilotAskResponse =
  | { ok: true; answer: string; rows: AnswerRow[]; customers: CustomerRow[]; source: string; asOf: string }
  | { ok: false; reason: "forbidden" | "unsupported" | "error"; message: string; supported: string[] };

const NOT_FOR_YOUR_ROLE = "Ask is for managers and admins. Your Co-pilot shows your own priorities above.";

export async function copilotAskAction(question: string): Promise<CopilotAskResponse> {
  const session = await requireAccess("copilot");
  // Refused in the answer, not by redirect, so the Co-pilot page keeps working for an RM. No query runs.
  if (!canAsk(session.user.role)) return { ok: false, reason: "forbidden", message: NOT_FOR_YOUR_ROLE, supported: [] };

  const text = question.trim().slice(0, 500);
  if (text.length < 5) {
    return { ok: false, reason: "unsupported", message: "Ask a full question, for example “Which KYC customers have not funded?”", supported: SUPPORTED_QUESTIONS };
  }

  const limited = await rateLimit("ask-system", session.user.id, { limit: 20, windowSeconds: 3600 });
  if (!limited.allowed) return { ok: false, reason: "error", message: "You've asked a lot of questions this hour. Try again shortly.", supported: [] };

  try {
    const visible = await getVisibleUserIds(session.user.id, session.user.role);
    const scope = managementScope(visible, session.user.role === "MANAGER");

    if (matchIntent(text)) {
      const found = await answerQuestion(text, scope);
      if (found.ok) return { ok: true, answer: found.answer, rows: found.rows, customers: [], source: found.source, asOf: found.asOf };
    }

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
