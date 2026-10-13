"use server";

import { z } from "zod";

import { requireAccess } from "@/lib/auth/require-role";
import { DraftNotApprovedError } from "@/lib/ai-execution/approval";
import { getCopilotState, requestReplyForTicket, sendApprovedReply, type CopilotState } from "@/lib/support/copilot/service";

/**
 * The Support co-pilot panel's server actions. Access is the Support SLA area (Manager and Admin). Nothing here sends a message on its own:
 * a reply goes to Freshdesk only through sendApprovedReplyAction, after a different person has approved the stored reply.
 */

const idSchema = z.string().min(1).max(40);
const MAX_BODY = 1200;

/** `draft: false` returns the facts and the approval state only, with no new model call (used after an approval step). */
export async function getCopilotAction(activityId: string, opts: { draft?: boolean } = {}): Promise<CopilotState> {
  const session = await requireAccess("support");
  return getCopilotState({ id: session.user.id, role: session.user.role }, idSchema.parse(activityId), { draft: opts.draft !== false });
}

export type RequestReplyResult = { status: "requested"; approvalRequestId: string } | { status: "refused"; message: string };

/** Stores the reviewed reply for an approver. Refused text (a rule, an identifier, a closed ticket) stores nothing. */
export async function requestReplyApprovalAction(activityId: string, body: string, source: "model" | "template", edited: boolean): Promise<RequestReplyResult> {
  const session = await requireAccess("support", "manage");
  const result = await requestReplyForTicket(
    { id: session.user.id, role: session.user.role },
    idSchema.parse(activityId),
    String(body ?? "").slice(0, MAX_BODY),
    z.enum(["model", "template"]).parse(source),
    edited ? "edited before approval" : null,
  );
  if (result.status === "requested") return { status: "requested", approvalRequestId: result.approvalRequestId };
  return { status: "refused", message: result.reason };
}

export type SendReplyResult = { status: "sent" } | { status: "refused"; message: string };

/** The approver sends the approved reply. Every check runs again first. Nothing is recorded as sent unless Freshdesk accepts it. */
export async function sendApprovedReplyAction(approvalRequestId: string): Promise<SendReplyResult> {
  const session = await requireAccess("support", "manage");
  try {
    await sendApprovedReply({ id: session.user.id, role: session.user.role }, idSchema.parse(approvalRequestId));
    return { status: "sent" };
  } catch (error) {
    // Our own refusals carry a plain reason. Anything else is generic: never echo a vendor or database error to the browser.
    if (error instanceof DraftNotApprovedError) return { status: "refused", message: error.message };
    if (error instanceof Error && error.message === "Not authorized to send this reply") return { status: "refused", message: error.message };
    console.error("support copilot: send failed", error instanceof Error ? error.name : "error");
    return { status: "refused", message: "The reply could not be sent right now." };
  }
}
