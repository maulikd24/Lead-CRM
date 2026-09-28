import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { deriveChatId } from "./phone";

export type OutboxItem = { id: string; sessionId: string; chatId: string; body: string };

type ClaimedRow = { id: string; body: string; metadata: unknown; clientId: string; sessionId: string };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/**
 * Atomically claims queued CRM-originated sends for the given Openwa sessions. FOR UPDATE SKIP
 * LOCKED makes concurrent polls safe; a claim older than 60 seconds is re-claimable so a
 * worker that crashes mid-send can't strand a message (delivery is at-least-once).
 */
export async function claimOutbox(sessionIds: string[], limit: number): Promise<OutboxItem[]> {
  if (sessionIds.length === 0) return [];

  const rows = await prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "Message" m
    SET "claimedAt" = NOW()
    FROM "WhatsAppAccount" a
    WHERE a.id = m."accountId"
      AND m.id IN (
        SELECT m2.id
        FROM "Message" m2
        JOIN "WhatsAppAccount" a2 ON a2.id = m2."accountId"
        WHERE m2.direction = 'OUTBOUND'
          AND m2.status = 'QUEUED'
          AND m2.origin = 'crm'
          AND a2."isActive" = true
          AND a2."sessionId" = ANY(${sessionIds})
          AND (m2."claimedAt" IS NULL OR m2."claimedAt" < NOW() - INTERVAL '60 seconds')
        ORDER BY m2."createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE OF m2 SKIP LOCKED
      )
    RETURNING m.id, m.body, m.metadata, m."clientId", a."sessionId"`;

  if (rows.length === 0) return [];

  const clients = await prisma.client.findMany({
    where: { id: { in: rows.map((r) => r.clientId) } },
    select: { id: true, mobile: true },
  });
  const mobileById = new Map(clients.map((c) => [c.id, c.mobile]));

  const items: OutboxItem[] = [];
  for (const row of rows) {
    const meta = row.metadata as { chatId?: string } | null;
    const mobile = mobileById.get(row.clientId);
    const chatId = meta?.chatId ?? (mobile ? deriveChatId(mobile) : null);
    if (!chatId) {
      await prisma.message.update({
        where: { id: row.id },
        data: { status: "FAILED", claimedAt: null, metadata: { ...(meta ?? {}), error: "No valid phone number" } },
      });
      continue;
    }
    items.push({ id: row.id, sessionId: row.sessionId, chatId, body: row.body });
  }
  return items;
}

/** Idempotent: the worker may retry this callback after a network failure. */
export async function completeOutbox(id: string, result: { ok: boolean; externalId?: string; error?: string }) {
  const message = await prisma.message.findUnique({ where: { id } });
  if (!message || message.direction !== "OUTBOUND" || message.origin !== "crm") return { found: false as const };

  if (!result.ok) {
    if (message.status === "QUEUED") {
      const meta = (message.metadata as Record<string, unknown> | null) ?? {};
      await prisma.message.update({
        where: { id },
        data: { status: "FAILED", claimedAt: null, metadata: { ...meta, error: result.error ?? "Send failed" } },
      });
    }
    return { found: true as const };
  }

  if (!result.externalId) return { found: true as const };

  // Already adopted by the fromMe echo (see ingestMessage) — nothing left to do.
  if (message.externalId === result.externalId) return { found: true as const };

  const firstCompletion = message.status === "QUEUED";
  try {
    await prisma.message.update({
      where: { id },
      data: { externalId: result.externalId, status: "SENT", sentAt: new Date(), claimedAt: null },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // The echo created a separate phone-origin row with this externalId first; keep that one.
    await prisma.message.delete({ where: { id } });
    return { found: true as const };
  }

  if (firstCompletion) {
    await logActivity({
      clientId: message.clientId,
      userId: message.senderUserId,
      type: "MESSAGE",
      payload: { direction: "OUTBOUND", channel: "whatsapp", body: message.body },
    });
  }
  return { found: true as const };
}
