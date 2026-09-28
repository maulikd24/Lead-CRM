import { z } from "zod";

const sessionId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "sessionId must not contain spaces or special characters");

export const messageEventSchema = z.object({
  type: z.literal("message"),
  sessionId,
  externalId: z.string().min(1).max(256),
  chatId: z.string().min(1).max(128),
  fromMe: z.boolean(),
  // For media messages the worker sends the caption (never Openwa's base64 body).
  body: z.string().max(20000).default(""),
  messageType: z.string().max(32).default("chat"),
  // Unix seconds (Openwa's `t`); milliseconds are tolerated.
  timestamp: z.number().positive(),
  pushName: z.string().max(200).optional(),
});

export const qrEventSchema = z.object({
  type: z.literal("qr"),
  sessionId,
  qr: z.string().min(20).max(400_000),
});

export const statusEventSchema = z.object({
  type: z.literal("status"),
  sessionId,
  status: z.enum(["DISCONNECTED", "QR_PENDING", "CONNECTING", "CONNECTED", "FAILED"]),
  phoneNumber: z.string().max(32).optional(),
  error: z.string().max(500).optional(),
});

export const heartbeatEventSchema = z.object({
  type: z.literal("heartbeat"),
  sessions: z.array(
    z.object({
      sessionId,
      status: z.enum(["DISCONNECTED", "QR_PENDING", "CONNECTING", "CONNECTED", "FAILED"]),
    }),
  ),
});

export const ackEventSchema = z.object({
  type: z.literal("ack"),
  sessionId,
  externalId: z.string().min(1).max(256),
  ack: z.number().int(),
});

export const workerEventSchema = z.discriminatedUnion("type", [
  messageEventSchema,
  qrEventSchema,
  statusEventSchema,
  heartbeatEventSchema,
  ackEventSchema,
]);

export const workerEventsBodySchema = z.object({ events: z.array(workerEventSchema).max(200) });

export type WorkerEvent = z.infer<typeof workerEventSchema>;
export type MessageEvent = z.infer<typeof messageEventSchema>;

export const outboxResultSchema = z.object({
  ok: z.boolean(),
  externalId: z.string().min(1).max(256).optional(),
  error: z.string().max(500).optional(),
});
