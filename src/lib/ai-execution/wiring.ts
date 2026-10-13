import { prisma } from "@/lib/db/prisma";
import { callModel } from "@/lib/ai/gateway";
import { buildAgentBriefing } from "@/lib/intelligence/agent";
import { recordInteractionOutcome } from "@/lib/intelligence/outcomes";
import { requestApproval } from "@/lib/policy/approvals/service";
import "@/lib/policy/approvals/registry-init";
import type { Actor } from "@/lib/policy/types";

import { requestDraftApproval } from "./approval";
import { checkDraft, guardDraftContext, type DraftKind } from "./draft";
import { draftContextFromBriefing } from "./context";
import { generateConversationDraft, type DraftOutcome } from "./generate";
import { recordAiHandover, type HandoverInput, type HandoverResult } from "./handover";
import { captureConversationOutcome, type CaptureOutcomeInput } from "./outcome";

/**
 * Production bindings for the AI execution layer. These are the only functions here that touch the database or a model.
 * Nothing in this file sends a message: a draft becomes an ApprovalRequest, and the send gate (approval.ts dispatchApprovedDraft)
 * is deliberately NOT bound to any sender until the owner decides on the WhatsApp send path.
 */

/**
 * Drafts a message for one customer from the read-only briefing. Returns the outcome and, for a draft, its ApprovalRequest id.
 * `storeApproval: false` returns the draft text only, so the RM can edit it and then call requestDraftApprovalForClient.
 * The default (true) stores the draft as an approval straight away, as before.
 */
export async function draftConversationForClient(
  clientId: string,
  actor: Actor,
  kind: DraftKind,
  opts: { storeApproval?: boolean } = {},
): Promise<{ outcome: DraftOutcome; approvalRequestId: string | null }> {
  const briefing = await buildAgentBriefing(clientId, { persist: false });
  if (!briefing) return { outcome: { status: "refused", reason: "customer not found" }, approvalRequestId: null };
  const ctx = draftContextFromBriefing(briefing, kind);
  const outcome = await generateConversationDraft(ctx, { callModel: (input) => callModel(input) });
  if (outcome.status === "refused" && outcome.routeToHandover) {
    // The model wrote a recommendation: nothing is stored, and the customer goes to an RM with the reason on record.
    await recordHandoverForClient({ clientId, actor, inboundText: "", portfolioValueInr: null, openIssueKinds: ctx.openIssueKinds, interest: null, mainConcern: outcome.reason, extraTriggers: ["needs_advice"] });
  }
  if (outcome.status !== "draft" || opts.storeApproval === false) return { outcome, approvalRequestId: null };
  const { approvalRequestId } = await requestDraftApproval(
    { clientId, kind: outcome.kind, body: outcome.body, source: outcome.source, note: outcome.note },
    actor,
    { requestApproval, now: () => new Date() },
  );
  return { outcome, approvalRequestId };
}

/**
 * Stores an RM-reviewed draft as an ApprovalRequest. The text is checked again against the customer's CURRENT context first, because
 * the RM may have edited it. A refused text stores nothing. Nothing is sent: the approval waits for a Manager or Admin decision.
 */
export async function requestDraftApprovalForClient(
  clientId: string,
  actor: Actor,
  draft: { kind: DraftKind; body: string; source: "model" | "template"; note: string | null },
): Promise<{ status: "requested"; approvalRequestId: string } | { status: "refused"; reason: string }> {
  const body = draft.body.trim();
  if (!body) return { status: "refused", reason: "the message is empty" };
  const briefing = await buildAgentBriefing(clientId, { persist: false });
  if (!briefing) return { status: "refused", reason: "customer not found" };
  const ctx = draftContextFromBriefing(briefing, draft.kind);
  const guard = guardDraftContext(ctx);
  if (!guard.ok) return { status: "refused", reason: guard.reason };
  const check = checkDraft(body, ctx);
  if (!check.ok) return { status: "refused", reason: check.reason };
  const { approvalRequestId } = await requestDraftApproval(
    { clientId, kind: draft.kind, body, source: draft.source, note: draft.note },
    actor,
    { requestApproval, now: () => new Date() },
  );
  return { status: "requested", approvalRequestId };
}

/**
 * Hands a customer to an RM from the inbox after a draft was refused. The reason is recorded as the main concern, so the RM sees why.
 * The trigger is chosen from the customer's record: an open complaint is a service call, anything else needs a person to look.
 */
export async function handOverConversationForClient(clientId: string, actor: Actor, reason: string): Promise<HandoverResult | { status: "refused"; reason: string }> {
  const briefing = await buildAgentBriefing(clientId, { persist: false });
  if (!briefing) return { status: "refused", reason: "customer not found" };
  const openIssueKinds = briefing.openIssues.map((i) => i.kind);
  return recordHandoverForClient({
    clientId,
    actor,
    inboundText: "",
    portfolioValueInr: null,
    openIssueKinds,
    interest: null,
    mainConcern: reason,
    extraTriggers: [openIssueKinds.length > 0 ? "sensitive_service_issue" : "complex_question"],
  });
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
