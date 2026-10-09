import { templateRequired, usesServiceWindow } from "./service-window";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { clientScopeWhere, type InboxScope, type InboxUser } from "./inbox-scope";
import { isAccountOnline, replyBlockReason, resolveReplyAccount } from "./send";

export type ConversationFilters = { q?: string; accountId?: string; assigneeId?: string; unreadOnly?: boolean };

export type ConversationSummary = {
  clientId: string;
  clientName: string;
  clientCode: string;
  mobile: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  lastBody: string;
  lastDirection: "INBOUND" | "OUTBOUND";
  lastAt: string;
  accountId: string;
  accountLabel: string;
  accountPhone: string | null;
  accountOnline: boolean;
  unread: number;
  latestReviewSentiment: string | null;
  latestReviewQualityScore: number | null;
};

export type ThreadMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  origin: string | null;
  body: string;
  mediaType: string | null;
  status: string;
  at: string;
  accountLabel: string | null;
  senderName: string | null;
  error: string | null;
};

export type ThreadData = {
  client: { id: string; name: string; clientCode: string; mobile: string | null; assigneeId: string | null; assigneeName: string | null };
  account: { id: string; label: string; phoneNumber: string | null; online: boolean } | null;
  canReply: boolean;
  replyBlockedReason: string | null;
  profileLinkable: boolean;
  messages: ThreadMessage[];
  /** The customer's latest message and whether it is still waiting for a reply; the suggested-reply panel keys off this. */
  lastInbound: { id: string; at: string } | null;
  unanswered: boolean;
  /** Meta Cloud API 24 h service window. `required` = free text is not allowed, an approved template is. Never true for WhatsApp-Web style accounts. */
  serviceWindow: { applies: boolean; required: boolean };
};

const CONVERSATION_LIMIT = 100;
const THREAD_LIMIT = 300;

type LatestRow = { messageId: string; clientId: string; accountId: string; body: string; direction: string; lastAt: Date };

/**
 * One row per client (their most recent WhatsApp message), newest first. The scope predicate is
 * applied inside the SQL — a row outside the caller's scope is never fetched, so there is nothing
 * for a later step to forget to filter.
 */
export async function listConversations(scope: InboxScope, filters: ConversationFilters = {}): Promise<ConversationSummary[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`m."accountId" IS NOT NULL`,
    Prisma.sql`c."isDeleted" = false`,
    Prisma.sql`c."mergedIntoId" IS NULL`,
  ];
  if (scope.assigneeIds) {
    conditions.push(Prisma.sql`c."assignedToId" = ANY(${scope.assigneeIds})`);
  } else if (filters.assigneeId) {
    conditions.push(Prisma.sql`c."assignedToId" = ${filters.assigneeId}`);
  }
  if (filters.accountId) conditions.push(Prisma.sql`m."accountId" = ${filters.accountId}`);
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
    conditions.push(Prisma.sql`(c.name ILIKE ${like} OR c.mobile ILIKE ${like} OR c."clientCode" ILIKE ${like})`);
  }
  if (filters.unreadOnly) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "Message" u
      WHERE u."clientId" = m."clientId" AND u.direction = 'INBOUND' AND u."readAt" IS NULL AND u."accountId" IS NOT NULL
    )`);
  }

  const latest = await prisma.$queryRaw<LatestRow[]>`
    SELECT * FROM (
      SELECT DISTINCT ON (m."clientId")
        m.id AS "messageId", m."clientId", m."accountId", m.body, m.direction::text AS direction,
        COALESCE(m."sentAt", m."createdAt") AS "lastAt"
      FROM "Message" m
      JOIN "Client" c ON c.id = m."clientId"
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY m."clientId", COALESCE(m."sentAt", m."createdAt") DESC
    ) t
    ORDER BY t."lastAt" DESC
    LIMIT ${CONVERSATION_LIMIT}`;

  if (latest.length === 0) return [];

  const clientIds = latest.map((r) => r.clientId);
  const [clients, accounts, unreadRows, latestReviews] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true, clientCode: true, mobile: true, assignedToId: true, assignedTo: { select: { name: true } } },
    }),
    prisma.whatsAppAccount.findMany(),
    prisma.message.groupBy({
      by: ["clientId"],
      where: { clientId: { in: clientIds }, direction: "INBOUND", readAt: null, accountId: { not: null } },
      _count: { _all: true },
    }),
    prisma.conversationReview.findMany({
      where: { clientId: { in: clientIds }, sourceType: "WHATSAPP_THREAD" },
      select: { clientId: true, sentimentLabel: true, qualityScore: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const unreadByClient = new Map(unreadRows.map((r) => [r.clientId, r._count._all]));
  // latestReviews is already newest-first — the first entry seen per clientId is the latest one.
  const latestReviewByClient = new Map<string, { sentimentLabel: string | null; qualityScore: number | null }>();
  for (const r of latestReviews) {
    if (!latestReviewByClient.has(r.clientId)) latestReviewByClient.set(r.clientId, r);
  }

  const summaries: ConversationSummary[] = [];
  for (const row of latest) {
    const client = clientById.get(row.clientId);
    const account = accountById.get(row.accountId);
    if (!client || !account) continue;
    summaries.push({
      clientId: client.id,
      clientName: client.name,
      clientCode: client.clientCode,
      mobile: client.mobile,
      assigneeId: client.assignedToId,
      assigneeName: client.assignedTo?.name ?? null,
      lastBody: row.body,
      lastDirection: row.direction === "INBOUND" ? "INBOUND" : "OUTBOUND",
      lastAt: row.lastAt.toISOString(),
      accountId: account.id,
      accountLabel: account.label,
      accountPhone: account.phoneNumber,
      accountOnline: isAccountOnline(account),
      unread: unreadByClient.get(client.id) ?? 0,
      latestReviewSentiment: latestReviewByClient.get(client.id)?.sentimentLabel ?? null,
      latestReviewQualityScore: latestReviewByClient.get(client.id)?.qualityScore ?? null,
    });
  }
  return summaries;
}

export async function getThread(viewer: InboxUser, scope: InboxScope, clientId: string): Promise<ThreadData | null> {
  // Out-of-scope and nonexistent ids are indistinguishable to the caller.
  const client = await prisma.client.findFirst({
    where: { id: clientId, ...clientScopeWhere(scope) },
    select: { id: true, name: true, clientCode: true, mobile: true, assignedToId: true, assignedTo: { select: { name: true } } },
  });
  if (!client) return null;

  const [rows, reply, visibleUserIds] = await Promise.all([
    prisma.message.findMany({
      where: { clientId, accountId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: THREAD_LIMIT,
      include: { account: { select: { label: true } }, sender: { select: { name: true } } },
    }),
    resolveReplyAccount(client.id, client.assignedToId),
    getVisibleUserIds(viewer.id, viewer.role),
  ]);

  // Unread is the assigned RM's to-do list: an Admin/Manager reading the thread must not clear it.
  if (viewer.id === client.assignedToId) {
    await prisma.message.updateMany({
      where: { clientId, direction: "INBOUND", readAt: null, accountId: { not: null } },
      data: { readAt: new Date() },
    });
  }

  const messages: ThreadMessage[] = rows
    .map((m) => ({ m, at: m.sentAt ?? m.createdAt }))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(({ m, at }) => ({
      id: m.id,
      direction: m.direction,
      origin: m.origin,
      body: m.body,
      mediaType: m.mediaType,
      status: m.status,
      at: at.toISOString(),
      accountLabel: m.account?.label ?? null,
      senderName: m.sender?.name ?? null,
      error: (m.metadata as { error?: string } | null)?.error ?? null,
    }));

  const block = replyBlockReason(viewer, client, reply.account);
  const lastInboundRow = rows.find((m) => m.direction === "INBOUND") ?? null; // rows are newest first
  const lastInboundAt = lastInboundRow ? (lastInboundRow.sentAt ?? lastInboundRow.createdAt) : null;
  const windowAccount = { provider: rows[0]?.provider ?? null };
  const profileLinkable = visibleUserIds === null || (client.assignedToId !== null && visibleUserIds.includes(client.assignedToId));

  return {
    client: {
      id: client.id,
      name: client.name,
      clientCode: client.clientCode,
      mobile: client.mobile,
      assigneeId: client.assignedToId,
      assigneeName: client.assignedTo?.name ?? null,
    },
    account: reply.account
      ? { id: reply.account.id, label: reply.account.label, phoneNumber: reply.account.phoneNumber, online: isAccountOnline(reply.account) }
      : null,
    canReply: !block.blocked,
    replyBlockedReason: block.blocked ? block.reason : null,
    profileLinkable,
    messages,
    lastInbound: lastInboundRow && lastInboundAt ? { id: lastInboundRow.id, at: lastInboundAt.toISOString() } : null,
    unanswered: rows.find((m) => m.status !== "FAILED")?.direction === "INBOUND",
    serviceWindow: { applies: usesServiceWindow(windowAccount), required: templateRequired(windowAccount, lastInboundAt, new Date()) },
  };
}

export async function listAccountsForFilter() {
  const accounts = await prisma.whatsAppAccount.findMany({ orderBy: { label: "asc" } });
  return accounts.map((a) => ({ id: a.id, label: a.label, phoneNumber: a.phoneNumber, online: isAccountOnline(a) }));
}
