import { config } from "./config";
import type { SessionStatus } from "./crm-client";
import type { MessageEventPayload } from "./protocol";

/** The subset of an Openwa message this worker reads (structural, so we don't depend on Openwa's branded types). */
export interface WaMessage {
  id: string;
  type?: string;
  body?: string;
  caption?: string;
  t?: number;
  timestamp?: number;
  from?: string;
  to?: string;
  chatId?: string;
  fromMe?: boolean;
  isGroupMsg?: boolean;
  notifyName?: string;
  sender?: { pushname?: string } | null;
}

/**
 * Maps Openwa v5's session STATE onto the CRM's status vocabulary. Returns null for states that must not
 * overwrite what the CRM already shows (AUTHENTICATING is expressed by the QR events, STOPPED by shutdown).
 */
export function mapSessionState(state: string): { status: SessionStatus; error?: string } | null {
  switch (state) {
    case "READY":
      return { status: "CONNECTED" };
    case "STARTING":
      return { status: "CONNECTING" };
    case "DISCONNECTED":
      return { status: "DISCONNECTED", error: "WhatsApp Web disconnected" };
    default:
      // AUTHENTICATING (QR shown), STOPPED (we are shutting down), anything new in a later alpha.
      return null;
  }
}

/**
 * Normalizes an Openwa message into the CRM's event shape, or null if it should never leave the worker.
 * For media messages Openwa's `body` is base64 file content — only the caption is forwarded, never the payload.
 */
export function toMessageEvent(sessionId: string, m: WaMessage): MessageEventPayload | null {
  if (m.isGroupMsg) return null;

  const chatId = String(m.chatId ?? (m.fromMe ? m.to : m.from) ?? "");
  if (!chatId) return null;

  const timestamp = Number(m.t ?? m.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  if (config.maxMessageAgeSeconds > 0) {
    const ageSeconds = Date.now() / 1000 - (timestamp > 1e12 ? timestamp / 1000 : timestamp);
    if (ageSeconds > config.maxMessageAgeSeconds) return null;
  }

  const messageType = String(m.type ?? "chat");
  const body = messageType === "chat" ? String(m.body ?? "") : String(m.caption ?? "");

  const pushName = m.fromMe ? undefined : (m.sender?.pushname ?? m.notifyName ?? undefined);

  return {
    type: "message",
    sessionId,
    externalId: String(m.id),
    chatId,
    fromMe: Boolean(m.fromMe),
    body,
    messageType,
    timestamp,
    pushName: pushName ? String(pushName).slice(0, 200) : undefined,
  };
}

/** Openwa v5's onAck payload is `{ messageId, ack }`; read it defensively (older shapes used `id`). */
export function toAck(payload: unknown): { externalId: string; ack: number } | null {
  const p = payload as { ack?: unknown; messageId?: unknown; id?: unknown } | null;
  if (!p || typeof p.ack !== "number") return null;
  const raw = p.messageId ?? p.id;
  const id = typeof raw === "string" ? raw : typeof (raw as { _serialized?: string } | undefined)?._serialized === "string" ? (raw as { _serialized: string })._serialized : null;
  if (!id) return null;
  return { externalId: id, ack: p.ack };
}
