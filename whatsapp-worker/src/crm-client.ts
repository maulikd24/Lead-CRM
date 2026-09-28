import crypto from "node:crypto";

import { config } from "./config";
import { errorMessage, log, sleep } from "./log";

export type SessionStatus = "DISCONNECTED" | "QR_PENDING" | "CONNECTING" | "CONNECTED" | "FAILED";

export type WorkerEvent =
  | {
      type: "message";
      sessionId: string;
      externalId: string;
      chatId: string;
      fromMe: boolean;
      body: string;
      messageType: string;
      timestamp: number;
      pushName?: string;
    }
  | { type: "qr"; sessionId: string; qr: string }
  | { type: "status"; sessionId: string; status: SessionStatus; phoneNumber?: string; error?: string }
  | { type: "heartbeat"; sessions: { sessionId: string; status: SessionStatus }[] }
  | { type: "ack"; sessionId: string; externalId: string; ack: number };

export type OutboxItem = { id: string; sessionId: string; chatId: string; body: string };

type EventResult = { outcome: string; reason?: string; error?: string };

const REQUEST_TIMEOUT_MS = 15_000;

/** Must produce exactly what the CRM's signWorkerRequest() does (src/lib/whatsapp/worker-auth.ts). */
function sign(timestamp: string, method: string, pathWithQuery: string, rawBody: string): string {
  return crypto
    .createHmac("sha256", config.secret)
    .update(`${timestamp}.${method.toUpperCase()}.${pathWithQuery}.${rawBody}`)
    .digest("hex");
}

export class CrmHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: "GET" | "POST", pathWithQuery: string, body?: unknown): Promise<T> {
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Date.now());
  const response = await fetch(`${config.crmBaseUrl}${pathWithQuery}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-worker-timestamp": timestamp,
      "x-worker-signature": sign(timestamp, method, pathWithQuery, rawBody),
    },
    body: method === "POST" ? rawBody : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    if (response.status === 401) {
      log.error("CRM rejected the signature (401) — check WHATSAPP_WORKER_SECRET matches the CRM and that this host's clock is correct");
    }
    throw new CrmHttpError(response.status, `CRM responded ${response.status} to ${method} ${pathWithQuery.split("?")[0]}`);
  }
  return (await response.json()) as T;
}

export async function claimOutbox(sessionIds: string[]): Promise<OutboxItem[]> {
  if (sessionIds.length === 0) return [];
  const result = await request<{ items: OutboxItem[] }>("GET", `/api/internal/whatsapp/outbox?sessionIds=${encodeURIComponent(sessionIds.join(","))}&limit=10`);
  return result.items;
}

/** Retries with backoff: a lost result would leave the message claimed until the 60s re-claim (then duplicated). */
export async function reportOutboxResult(id: string, result: { ok: boolean; externalId?: string; error?: string }): Promise<void> {
  const delays = [0, 1_000, 3_000, 8_000, 20_000];
  let lastError: unknown;
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      await request("POST", `/api/internal/whatsapp/outbox/${encodeURIComponent(id)}/result`, result);
      return;
    } catch (error) {
      lastError = error;
      // A 404 means the message is gone — retrying can never succeed.
      if (error instanceof CrmHttpError && (error.status === 404 || error.status === 400)) return;
    }
  }
  log.error("Could not report send result to the CRM after retries", { messageId: id, error: errorMessage(lastError) });
}

const MAX_BUFFERED_EVENTS = 5_000;
const MAX_BATCH = 50;
const MAX_EVENT_ATTEMPTS = 5;

type Queued = { event: WorkerEvent; attempts: number };

/**
 * In-order, batched, retrying event publisher. If the CRM is unreachable events are held in memory
 * (bounded) and flushed when it returns. Heartbeats and QR codes are latest-wins, so they are
 * coalesced instead of piling up during an outage.
 */
export class EventPublisher {
  private queue: Queued[] = [];
  private running = false;
  private backoffMs = 1_000;
  private stopped = false;

  enqueue(event: WorkerEvent): void {
    if (event.type === "heartbeat") {
      this.queue = this.queue.filter((q) => q.event.type !== "heartbeat");
    } else if (event.type === "qr") {
      this.queue = this.queue.filter((q) => !(q.event.type === "qr" && q.event.sessionId === event.sessionId));
    }
    this.queue.push({ event, attempts: 0 });
    if (this.queue.length > MAX_BUFFERED_EVENTS) {
      const dropped = this.queue.length - MAX_BUFFERED_EVENTS;
      this.queue.splice(0, dropped);
      log.error("Event buffer full while the CRM is unreachable — dropped oldest events", { dropped });
    }
    void this.flush();
  }

  stop(): void {
    this.stopped = true;
  }

  async drain(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.queue.length > 0 && Date.now() < deadline) {
      await this.flush();
      await sleep(200);
    }
  }

  private removeFromQueue(items: Queued[]): void {
    const remove = new Set(items);
    this.queue = this.queue.filter((q) => !remove.has(q));
  }

  private async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const batch = this.queue.slice(0, MAX_BATCH);
        try {
          const response = await request<{ results: EventResult[] }>("POST", "/api/internal/whatsapp/events", { events: batch.map((b) => b.event) });
          // Remove by identity, not position: enqueue() may have coalesced (removed) items while the request was in flight.
          this.removeFromQueue(batch);
          this.backoffMs = 1_000;

          const retry: Queued[] = [];
          response.results.forEach((result, i) => {
            if (result.outcome !== "error") return;
            const item = batch[i];
            if (item && item.attempts + 1 < MAX_EVENT_ATTEMPTS) retry.push({ event: item.event, attempts: item.attempts + 1 });
            else log.error("Dropping event the CRM keeps failing on", { type: item?.event.type, error: result.error });
          });
          if (retry.length > 0) {
            this.queue.unshift(...retry);
            await sleep(this.backoffMs);
          }
        } catch (error) {
          if (error instanceof CrmHttpError && error.status === 400) {
            // Malformed payload will never succeed — drop it rather than block everything behind it.
            log.error("CRM rejected an event batch as invalid; dropping it", { size: batch.length });
            this.removeFromQueue(batch);
            continue;
          }
          log.warn("CRM unreachable, will retry", { error: errorMessage(error), buffered: this.queue.length, retryInMs: this.backoffMs });
          await sleep(this.backoffMs);
          this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
