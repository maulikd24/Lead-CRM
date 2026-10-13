import { prisma } from "@/lib/db/prisma";
import { callModel } from "@/lib/ai/gateway";
import { buildAgentBriefing } from "@/lib/intelligence/agent";
import { recordInteractionOutcome } from "@/lib/intelligence/outcomes";
import { requestApproval } from "@/lib/policy/approvals/service";
import "@/lib/policy/approvals/registry-init";
import type { Actor } from "@/lib/policy/types";

import { requestDraftApproval } from "./approval";
import { draftContextFromBriefing } from "./context";
import { generateConversationDraft, type DraftOutcome } from "./generate";
import { recordAiHandover, type HandoverInput, type HandoverResult } from "./handover";
import { captureConversationOutcome, type CaptureOutcomeInput } from "./outcome";
import type { DraftKind } from "./draft";

/**
 * Production bindings for the AI execution layer. These are the only functions here that touch the database or a model.
 * Nothing in this file sends a message: a draft becomes an ApprovalRequest, and the send gate (approval.ts dispatchApprovedDraft)
 * is deliberately NOT bound to any sender until the owner decides on the WhatsApp send path.
 */

/** Drafts a message for one customer from the read-only briefing. Returns the outcome and, for a draft, its ApprovalRequest id. */
export async function draftConversationForClient(
  clientId: string,
  actor: Actor,
  kind: DraftKind,
): Promise<{ outcome: DraftOutcome; approvalRequestId: string | null }> {
  const briefing = await buildAgentBriefing(clientId, { persist: false });
  if (!briefing) return { outcome: { status: "refused", reason: "customer not found" }, approvalRequestId: null };
  const ctx = draftContextFromBriefing(briefing, kind);
  const outcome = await generateConversationDraft(ctx, { callModel: (input) => callModel(input) });
  if (outcome.status === "refused" && outcome.routeToHandover) {
    // The model wrote a recommendation: nothing is stored, and the customer goes to an RM with the reason on record.
    await recordHandoverForClient({ clientId, actor, inboundText: "", portfolioValueInr: null, openIssueKinds: ctx.openIssueKinds, interest: null, mainConcern: outcome.reason, extraTriggers: ["needs_advice"] });
  }
  if (outcome.status !== "draft") return { outcome, approvalRequestId: null };
  const { approvalRequestId } = await requestDraftApproval(
    { clientId, kind: outcome.kind, body: outcome.body, source: outcome.source, note: outcome.note },
    actor,
    { requestApproval, now: () => new Date() },
  );
  return { outcome, approvalRequestId };
}

/** Records an AI-to-RM handover when a trigger fires. Idempotent while a handover to a person is already open. */
export async function recordHandoverForClient(input: HandoverInput): Promise<HandoverResult> {
  return recordAiHandover(input, {
    hasOpenHandover: async (clientId) => {
      const open = await prisma.task.findFirst({
        where: { clientId, source: { startsWith: "handover:" }, status: { in: ["PENDING", "OVERDUE"] } },
        select: { id: true },
      });
      return open !== null;
    },
    captureOutcome: captureOutcome,
    requestApproval,
    now: () => new Date(),
  });
}

/** Records a conversation outcome through the existing outcome path. */
export function captureOutcome(input: CaptureOutcomeInput): Promise<unknown> {
  return captureConversationOutcome(input, { record: recordInteractionOutcome });
}
