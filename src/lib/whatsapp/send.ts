import { prisma } from "@/lib/db/prisma";
import { canReplyTo, type InboxUser } from "./inbox-scope";
import { deriveChatId } from "./phone";
import type { WhatsAppAccount } from "@/generated/prisma/client";

export const ONLINE_THRESHOLD_MS = 90_000;
export const MAX_REPLY_LENGTH = 4096;

export function isAccountOnline(account: Pick<WhatsAppAccount, "status" | "lastSeenAt" | "isActive">, now = Date.now()): boolean {
  return (
    account.isActive &&
    account.status === "CONNECTED" &&
    account.lastSeenAt !== null &&
    now - account.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS
  );
}

/**
 * Replies always leave from the number the conversation already lives on (the account of the
 * client's most recent WhatsApp message) — even after reassignment, so the customer keeps one
 * continuous chat. Only a client with no WhatsApp history falls back to the assigned RM's own number.
 */
export async function resolveReplyAccount(clientId: string, assignedToId: string | null) {
  const latest = await prisma.message.findFirst({
    where: { clientId, accountId: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { account: true },
  });
  if (latest?.account) {
    const meta = latest.metadata as { chatId?: string } | null;
    return { account: latest.account, chatId: meta?.chatId ?? null };
  }
  if (assignedToId) {
    const own = await prisma.whatsAppAccount.findUnique({ where: { ownerUserId: assignedToId } });
    if (own) return { account: own, chatId: null };
  }
  return { account: null, chatId: null };
}

export type ReplyBlock = { blocked: true; reason: string } | { blocked: false };

export function replyBlockReason(
  user: InboxUser,
  client: { assignedToId: string | null },
  account: Pick<WhatsAppAccount, "label" | "status" | "lastSeenAt" | "isActive"> | null,
): ReplyBlock {
  if (user.role === "MANAGER") return { blocked: true, reason: "View-only: managers can't reply from the inbox." };
  if (!canReplyTo(user, client)) return { blocked: true, reason: "You can only reply to conversations assigned to you." };
  if (!account) return { blocked: true, reason: "No WhatsApp number is linked to this conversation." };
  if (!isAccountOnline(account)) return { blocked: true, reason: `${account.label}'s WhatsApp is offline — messages can't be sent right now.` };
  return { blocked: false };
}

export async function queueWhatsAppReply(input: { user: InboxUser; clientId: string; body: string }) {
  const body = input.body.trim();
  if (!body) throw new Error("Message can't be empty");
  if (body.length > MAX_REPLY_LENGTH) throw new Error(`Message is too long (max ${MAX_REPLY_LENGTH} characters)`);

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, isDeleted: false, mergedIntoId: null },
    select: { id: true, assignedToId: true, mobile: true },
  });
  // Same not-found response whether the id is missing or out of scope — no existence leak.
  if (!client) throw new Error("Conversation not found");

  const { account, chatId } = await resolveReplyAccount(client.id, client.assignedToId);
  const block = replyBlockReason(input.user, client, account);
  if (block.blocked) throw new Error(block.reason);
  if (!account) throw new Error("No WhatsApp number is linked to this conversation.");

  const resolvedChatId = chatId ?? (client.mobile ? deriveChatId(client.mobile) : null);
  if (!resolvedChatId) throw new Error("This client has no valid phone number to message.");

  return prisma.message.create({
    data: {
      clientId: client.id,
      accountId: account.id,
      channel: "whatsapp",
      provider: "whatsapp_openwa",
      direction: "OUTBOUND",
      origin: "crm",
      senderUserId: input.user.id,
      body,
      status: "QUEUED",
      metadata: { chatId: resolvedChatId },
    },
  });
}
