"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/require-role";
import { clientScopeWhere, getInboxScope } from "@/lib/whatsapp/inbox-scope";
import {
  getThread,
  listConversations,
  type ConversationFilters,
  type ConversationSummary,
  type ThreadData,
} from "@/lib/whatsapp/inbox-queries";
import { getAssistState, runSuggestion, dismissSuggestion, recordSuggestionUsed, type AssistState } from "@/lib/agents/reply-assist-service";
import { templateRequired } from "@/lib/whatsapp/service-window";
import { queueWhatsAppReply, replyBlockReason, resolveReplyAccount } from "@/lib/whatsapp/send";

/** Every action re-derives the caller's scope server-side; nothing the browser sends widens it. */
async function requireInboxAccess() {
  const session = await requireUser();
  const user = { id: session.user.id, role: session.user.role };
  const scope = getInboxScope(user);
  if (!scope) throw new Error("Not authorized");
  return { user, scope };
}

function sanitizeFilters(filters: ConversationFilters): ConversationFilters {
  return {
    q: typeof filters.q === "string" ? filters.q.slice(0, 100) : undefined,
    accountId: typeof filters.accountId === "string" && filters.accountId ? filters.accountId.slice(0, 64) : undefined,
    assigneeId: typeof filters.assigneeId === "string" && filters.assigneeId ? filters.assigneeId.slice(0, 64) : undefined,
    unreadOnly: filters.unreadOnly === true,
  };
}

export async function listConversationsAction(filters: ConversationFilters): Promise<ConversationSummary[]> {
  const { scope } = await requireInboxAccess();
  return listConversations(scope, sanitizeFilters(filters));
}

export async function getThreadAction(clientId: string): Promise<ThreadData | null> {
  const { user, scope } = await requireInboxAccess();
  return getThread(user, scope, String(clientId));
}

/** Reply composer send. `suggestionId` (optional) links the send to a suggested reply so its outcome is recorded; the RM's own send is the approval. */
export async function sendReplyAction(clientId: string, body: string, suggestionId?: string) {
  const { user, scope } = await requireInboxAccess();

  // Confirm the conversation is inside the caller's scope before queueing anything.
  const inScope = await prisma.client.findFirst({ where: { id: String(clientId), ...clientScopeWhere(scope) }, select: { id: true } });
  if (!inScope) throw new Error("Conversation not found");

  // Meta Cloud API conversations: outside the 24 h service window only an approved template may be sent, never free text.
  const latest = await prisma.message.findFirst({ where: { clientId: inScope.id, accountId: { not: null } }, orderBy: { createdAt: "desc" }, select: { provider: true } });
  const lastInbound = await prisma.message.findFirst({ where: { clientId: inScope.id, accountId: { not: null }, direction: "INBOUND" }, orderBy: { createdAt: "desc" }, select: { sentAt: true, createdAt: true } });
  if (templateRequired({ provider: latest?.provider }, lastInbound ? (lastInbound.sentAt ?? lastInbound.createdAt) : null, new Date())) {
    throw new Error("The 24-hour WhatsApp window has closed. Send an approved template instead.");
  }

  const message = await queueWhatsAppReply({ user, clientId: inScope.id, body: String(body) });
  if (suggestionId) await recordSuggestionUsed(user, inScope.id, String(suggestionId), String(body), message.id);
}

export async function getAssistAction(clientId: string): Promise<AssistState> {
  const { user } = await requireInboxAccess();
  return getAssistState(user, String(clientId));
}

export async function suggestReplyAction(clientId: string, opts?: { regenerate?: boolean; auto?: boolean }): Promise<AssistState> {
  const { user } = await requireInboxAccess();
  return runSuggestion(user, String(clientId), { regenerate: opts?.regenerate === true, auto: opts?.auto === true });
}

export async function dismissSuggestionAction(clientId: string, proposalId: string): Promise<AssistState> {
  const { user } = await requireInboxAccess();
  return dismissSuggestion(user, String(clientId), String(proposalId));
}

export async function retryMessageAction(messageId: string) {
  const { user, scope } = await requireInboxAccess();

  const message = await prisma.message.findUnique({ where: { id: String(messageId) } });
  if (!message || message.direction !== "OUTBOUND" || message.origin !== "crm" || message.status !== "FAILED") {
    throw new Error("Message can't be retried");
  }

  const client = await prisma.client.findFirst({
    where: { id: message.clientId, ...clientScopeWhere(scope) },
    select: { id: true, assignedToId: true },
  });
  if (!client) throw new Error("Conversation not found");

  const { account } = await resolveReplyAccount(client.id, client.assignedToId);
  const block = replyBlockReason(user, client, account);
  if (block.blocked) throw new Error(block.reason);

  const meta: Record<string, unknown> = { ...((message.metadata as Record<string, unknown> | null) ?? {}) };
  delete meta.error;
  await prisma.message.update({
    where: { id: message.id },
    data: { status: "QUEUED", claimedAt: null, metadata: meta as object },
  });
}
