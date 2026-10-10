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
  const thread = await getThread(user, scope, String(clientId));
  if (thread && process.env.NEXT_PUBLIC_CONSENT === "1") {
    thread.consentWarning = await (await import("@/lib/consent/warning-wiring")).consentWarningFor(thread.client.id).catch(() => null);
  }
  return thread;
}

export async function sendReplyAction(clientId: string, body: string) {
  const { user, scope } = await requireInboxAccess();

  // Confirm the conversation is inside the caller's scope before queueing anything.
  const inScope = await prisma.client.findFirst({ where: { id: String(clientId), ...clientScopeWhere(scope) }, select: { id: true } });
  if (!inScope) throw new Error("Conversation not found");

  await queueWhatsAppReply({ user, clientId: inScope.id, body: String(body) });
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
