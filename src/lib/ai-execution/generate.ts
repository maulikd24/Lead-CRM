import type { CallInput, GatewayResult } from "@/lib/ai/gateway/types";

import { buildTemplateDraft, buildUserPrompt, checkDraft, guardDraftContext, SYSTEM_PROMPT, type DraftContext, type DraftKind } from "./draft";

/**
 * Conversation draft generator (AI execution layer, bible 08). Produces a DRAFT only. Nothing here sends anything: the caller
 * stores the draft as an ApprovalRequest (approval.ts) and a person approves it.
 *
 * Every model call goes through callModel() with a named purpose. With no AI key, a deterministic template is used instead.
 */
export const CONVERSATION_DRAFT_PURPOSE = "conversation.draft";

export type DraftDeps = {
  callModel: (input: CallInput) => Promise<GatewayResult>;
};

export type DraftOutcome =
  /** No draft: the context is not allowed one (open complaint, or the customer asked not to be contacted). No model was called for a guard refusal. */
  | { status: "refused"; reason: string }
  /** No draft: the gateway stopped the call (consent, kill switch, data class). The reason is the gateway's own. */
  | { status: "blocked"; reason: string }
  | { status: "draft"; kind: DraftKind; body: string; source: "model" | "template"; note: string | null };

export async function generateConversationDraft(ctx: DraftContext, deps: DraftDeps): Promise<DraftOutcome> {
  const guard = guardDraftContext(ctx);
  if (!guard.ok) return { status: "refused", reason: guard.reason };

  const result = await deps.callModel({
    purpose: "conversation.draft",
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(ctx),
    subject: { type: "client", id: ctx.clientId },
    maxTokens: 300,
  });

  let note: string | null = null;
  switch (result.kind) {
    case "ok": {
      const text = result.text.trim();
      const verdict = text ? checkDraft(text, ctx) : { ok: false as const, reason: "empty model output" };
      if (verdict.ok) return { status: "draft", kind: ctx.kind, body: text, source: "model", note: null };
      note = `model draft not used: ${verdict.reason}`;
      break;
    }
    case "abstain":
      if (result.reason === "do_not_contact") return { status: "refused", reason: "the customer has asked not to be contacted" };
      note = `model abstained: ${result.reason}`;
      break;
    case "blocked":
      // A budget cap is an operating limit, not a customer rule: the deterministic template still applies. Everything else stops here.
      if (!result.reason.startsWith("budget_")) return { status: "blocked", reason: `${result.reason}${result.detail ? `: ${result.detail}` : ""}` };
      note = `model budget reached: ${result.reason}`;
      break;
    case "failed":
      note = result.errorClass === "not_configured" ? "no AI key configured: template draft" : `model unavailable (${result.errorClass}): template draft`;
      break;
  }

  const body = buildTemplateDraft(ctx);
  const verdict = checkDraft(body, ctx);
  if (!verdict.ok) return { status: "refused", reason: `template draft failed its checks: ${verdict.reason}` };
  return { status: "draft", kind: ctx.kind, body, source: "template", note };
}
