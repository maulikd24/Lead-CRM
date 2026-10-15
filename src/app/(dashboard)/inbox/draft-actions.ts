"use server";

import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import { requireAccess } from "@/lib/auth/require-role";
import { draftConversationForClient, handOverConversationForClient, requestDraftApprovalForClient } from "@/lib/ai-execution/wiring";
import { approvalRefusalCopy, draftRefusalCopy } from "@/lib/ai-execution/refusal-copy";
import type { Actor } from "@/lib/policy/types";
import { canReplyTo, clientScopeWhere, getInboxScope, type InboxUser } from "@/lib/whatsapp/inbox-scope";

/**
 * "Draft with AI" for the open WhatsApp conversation. A draft is made only on the RM's explicit request. It is stored as an approval
 * only when the RM sends it for approval, and nothing here sends a message. Access is the reply rule of the inbox: the assigned RM,
 * or an Admin. Managers are view-only in the inbox, so they cannot draft here either.
 */

const idSchema = z.string().min(1).max(40);
const MAX_BODY = 4096;

/** Same scope as the inbox reply path: re-derived on the server, never taken from the browser. */
async function requireDraftAccess(clientId: string): Promise<{ actor: Actor; clientId: string }> {
  const session = await requireAccess("inbox", "manage");
  const user: InboxUser = { id: session.user.id, role: session.user.role };
  const scope = getInboxScope(user);
  if (!scope) throw new Error("Not authorized");
  const client = await prisma.client.findFirst({
    where: { id: idSchema.parse(clientId), ...clientScopeWhere(scope) },
    select: { id: true, assignedToId: true },
  });
  if (!client) throw new Error("Conversation not found");
  if (!canReplyTo(user, client)) throw new Error("View-only: managers can't draft replies from the inbox.");
  return { actor: { id: user.id, role: user.role }, clientId: client.id };
}

export type DraftWithAiResult =
  | { status: "draft"; body: string; source: "model" | "template"; note: string | null }
  | { status: "refused"; message: string; canHandOver: boolean };

export async function draftWithAiAction(clientId: string): Promise<DraftWithAiResult> {
  const { actor, clientId: id } = await requireDraftAccess(clientId);
  const { outcome } = await draftConversationForClient(id, actor, "conversation", { storeApproval: false });
  if (outcome.status === "draft") return { status: "draft", body: outcome.body, source: outcome.source, note: outcome.note };
  return { status: "refused", ...draftRefusalCopy(outcome) };
}

export type RequestApprovalResult = { status: "requested"; approvalRequestId: string } | { status: "refused"; message: string; canHandOver: boolean };

/** Stores the RM's reviewed text as an approval for a Manager or Admin to decide. Does not send. */
export async function requestDraftApprovalAction(clientId: string, body: string, edited: boolean, source: "model" | "template"): Promise<RequestApprovalResult> {
  const { actor, clientId: id } = await requireDraftAccess(clientId);
  const text = String(body ?? "").slice(0, MAX_BODY);
  const result = await requestDraftApprovalForClient(id, actor, {
    kind: "conversation",
    body: text,
    source,
    note: edited ? "edited by the RM before approval" : null,
  });
  if (result.status === "requested") return { status: "requested", approvalRequestId: result.approvalRequestId };
  return { status: "refused", ...approvalRefusalCopy(result.reason) };
}

export type HandOverResult = { status: "handed_over" } | { status: "already_open" } | { status: "refused"; message: string };

/** Passes the conversation to the RM with the refusal reason on record. Creates the RM task through the existing outcome path. */
export async function handOverToRmAction(clientId: string, reason: string): Promise<HandOverResult> {
  const { actor, clientId: id } = await requireDraftAccess(clientId);
  const plain = String(reason ?? "").slice(0, 300) || "AI drafting was not possible for this customer";
  const result = await handOverConversationForClient(id, actor, plain);
  if (result.status === "handed_over") return { status: "handed_over" };
  if (result.status === "already_open") return { status: "already_open" };
  return { status: "refused", message: "This conversation could not be handed over right now." };
}
