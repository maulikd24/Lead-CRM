import { prisma } from "@/lib/db/prisma";
import { logActivity } from "@/lib/activities/log-activity";
import { resolveInboundClient } from "@/lib/clients/inbound-contact";
import { findClientByPhoneKey, mobileForNewLead, parseChatId } from "./phone";
import type { MessageEvent, WorkerEvent } from "./events";
import type { MessageStatus, WhatsAppAccountStatus } from "@/generated/prisma/client";

export type IngestResult =
  | { outcome: "created" | "adopted" | "duplicate" | "updated"; clientId?: string }
  | { outcome: "ignored" | "skipped"; reason: string }
  | { outcome: "error"; error: string };

const IGNORED_MESSAGE_TYPES = new Set([
  "e2e_notification",
  "notification",
  "notification_template",
  "broadcast_notification",
  "protocol",
  "gp2",
  "call_log",
  "ciphertext",
  "revoked",
]);

const MEDIA_LABELS: Record<string, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  ptt: "Voice message",
  document: "Document",
  sticker: "Sticker",
  location: "Location",
  vcard: "Contact",
  multi_vcard: "Contacts",
};

const MAX_BODY_LENGTH = 4096;
const ADOPT_WINDOW_MS = 5 * 60 * 1000;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** Only real image data URLs may ever reach an <img src> — anything else is rejected, not sanitized. */
export function normalizeQr(raw: string): string | null {
  if (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(raw)) return raw;
  if (/^[A-Za-z0-9+/=]+$/.test(raw)) return `data:image/png;base64,${raw}`;
  return null;
}

function toDate(timestamp: number): Date {
  return new Date(timestamp > 1e12 ? timestamp : timestamp * 1000);
}

const ACK_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

async function ingestMessage(event: MessageEvent): Promise<IngestResult> {
  const account = await prisma.whatsAppAccount.findUnique({ where: { sessionId: event.sessionId } });
  if (!account || !account.isActive) return { outcome: "ignored", reason: "unknown-or-inactive-account" };

  if (IGNORED_MESSAGE_TYPES.has(event.messageType)) return { outcome: "ignored", reason: "system-message" };

  const chat = parseChatId(event.chatId);
  if (chat.kind === "ignored") return { outcome: "ignored", reason: chat.reason };

  const existing = await prisma.message.findUnique({
    where: { accountId_externalId: { accountId: account.id, externalId: event.externalId } },
    select: { id: true, clientId: true },
  });
  if (existing) return { outcome: "duplicate", clientId: existing.clientId };

  const sentAt = toDate(event.timestamp);
  const label = MEDIA_LABELS[event.messageType];
  const isMedia = event.messageType !== "chat";
  const rawBody = event.body.slice(0, MAX_BODY_LENGTH);
  const body = isMedia ? (rawBody ? `[${label ?? event.messageType}] ${rawBody}` : `[${label ?? event.messageType}]`) : rawBody;
  if (!body) return { outcome: "ignored", reason: "empty-message" };

  let client = await findClientByPhoneKey(chat.key);

  if (!client) {
    // A number the RM typed to from their phone with no reply yet must not silently become a lead —
    // RMs' non-lead chats (vendors, family) would flood the pipeline.
    if (event.fromMe) return { outcome: "skipped", reason: "outbound-to-unknown-contact" };

    const resolved = await resolveInboundClient({
      phone: mobileForNewLead(chat.digits),
      name: event.pushName,
      leadSource: "WhatsApp",
      assignedToId: account.ownerUserId ?? undefined,
    });
    client = { id: resolved.client.id, name: resolved.client.name, assignedToId: resolved.client.assignedToId };
  }

  // Race guard: a message the CRM just sent produces a fromMe echo from Openwa. If the outbox result
  // callback hasn't landed yet, adopt the in-flight CRM row instead of recording a phone-origin twin.
  if (event.fromMe) {
    const pending = await prisma.message.findFirst({
      where: {
        accountId: account.id,
        clientId: client.id,
        direction: "OUTBOUND",
        origin: "crm",
        externalId: null,
        claimedAt: { not: null },
        body,
        createdAt: { gte: new Date(Date.now() - ADOPT_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (pending) {
      await prisma.message.update({
        where: { id: pending.id },
        data: { externalId: event.externalId, status: "SENT", sentAt, claimedAt: null },
      });
      return { outcome: "adopted", clientId: client.id };
    }
  }

  try {
    await prisma.message.create({
      data: {
        clientId: client.id,
        accountId: account.id,
        channel: "whatsapp",
        provider: "whatsapp_openwa",
        direction: event.fromMe ? "OUTBOUND" : "INBOUND",
        origin: event.fromMe ? "phone" : "customer",
        body,
        status: event.fromMe ? "SENT" : "DELIVERED",
        externalId: event.externalId,
        sentAt,
        mediaType: isMedia ? event.messageType : null,
        metadata: { chatId: event.chatId, ...(event.pushName ? { pushName: event.pushName } : {}) },
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "duplicate", clientId: client.id };
    throw error;
  }

  await logActivity({
    clientId: client.id,
    type: "MESSAGE",
    payload: {
      direction: event.fromMe ? "OUTBOUND" : "INBOUND",
      channel: "whatsapp",
      body,
      account: account.label,
    },
  });

  if (!event.fromMe && client.assignedToId) {
    const alreadyNotified = await prisma.notification.findFirst({
      where: {
        userId: client.assignedToId,
        type: "inbound_message",
        readAt: null,
        payload: { path: ["clientId"], equals: client.id },
      },
      select: { id: true },
    });
    if (!alreadyNotified) {
      await prisma.notification.create({
        data: {
          userId: client.assignedToId,
          type: "inbound_message",
          payload: { clientId: client.id, clientName: client.name, accountLabel: account.label, preview: body.slice(0, 120) },
        },
      });
    }
  }

  await prisma.whatsAppAccount.update({ where: { id: account.id }, data: { lastSeenAt: new Date() } });
  return { outcome: "created", clientId: client.id };
}

async function ingestAck(sessionId: string, externalId: string, ack: number): Promise<IngestResult> {
  const account = await prisma.whatsAppAccount.findUnique({ where: { sessionId }, select: { id: true } });
  if (!account) return { outcome: "ignored", reason: "unknown-account" };

  // Openwa ack levels: -1 error, 1 server, 2 delivered, 3 read, 4 played.
  const next: MessageStatus | null = ack >= 3 ? "READ" : ack === 2 ? "DELIVERED" : ack === 1 ? "SENT" : ack === -1 ? "FAILED" : null;
  if (!next) return { outcome: "ignored", reason: "unhandled-ack" };

  const message = await prisma.message.findUnique({
    where: { accountId_externalId: { accountId: account.id, externalId } },
    select: { id: true, status: true, direction: true },
  });
  if (!message || message.direction !== "OUTBOUND") return { outcome: "ignored", reason: "no-matching-outbound-message" };

  // Status only ever moves forward; FAILED never overwrites a delivered/read message.
  if (next === "FAILED") {
    if (message.status === "QUEUED" || message.status === "SENT") {
      await prisma.message.update({ where: { id: message.id }, data: { status: "FAILED" } });
    }
  } else if ((ACK_RANK[next] ?? 0) > (ACK_RANK[message.status] ?? 0)) {
    await prisma.message.update({ where: { id: message.id }, data: { status: next } });
  }
  return { outcome: "updated" };
}

export async function processWorkerEvent(event: WorkerEvent): Promise<IngestResult> {
  try {
    switch (event.type) {
      case "message":
        return await ingestMessage(event);
      case "ack":
        return await ingestAck(event.sessionId, event.externalId, event.ack);
      case "qr": {
        const qr = normalizeQr(event.qr);
        if (!qr) return { outcome: "ignored", reason: "invalid-qr" };
        const result = await prisma.whatsAppAccount.updateMany({
          where: { sessionId: event.sessionId },
          data: { status: "QR_PENDING", qrDataUrl: qr, qrUpdatedAt: new Date(), lastSeenAt: new Date() },
        });
        return result.count ? { outcome: "updated" } : { outcome: "ignored", reason: "unknown-account" };
      }
      case "status": {
        const connected = event.status === "CONNECTED";
        const result = await prisma.whatsAppAccount.updateMany({
          where: { sessionId: event.sessionId },
          data: {
            status: event.status,
            lastSeenAt: new Date(),
            lastError: connected ? null : (event.error ?? undefined),
            ...(event.phoneNumber ? { phoneNumber: event.phoneNumber.replace(/\D/g, "") } : {}),
            ...(connected ? { qrDataUrl: null, qrUpdatedAt: null } : {}),
          },
        });
        return result.count ? { outcome: "updated" } : { outcome: "ignored", reason: "unknown-account" };
      }
      case "heartbeat": {
        const now = new Date();
        for (const session of event.sessions) {
          const status = session.status as WhatsAppAccountStatus;
          await prisma.whatsAppAccount.updateMany({
            where: { sessionId: session.sessionId },
            data: {
              lastSeenAt: now,
              status,
              ...(status === "CONNECTED" ? { qrDataUrl: null, qrUpdatedAt: null, lastError: null } : {}),
            },
          });
        }
        return { outcome: "updated" };
      }
    }
  } catch (error) {
    console.error("WhatsApp event failed", event.type, error);
    return { outcome: "error", error: error instanceof Error ? error.message : "Unknown error" };
  }
}
