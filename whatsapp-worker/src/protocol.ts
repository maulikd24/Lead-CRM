import type { SessionStatus, WorkerEvent } from "./crm-client";

export type MessageEventPayload = Extract<WorkerEvent, { type: "message" }>;

/** IPC messages: session child process -> supervisor. */
export type ChildToParent =
  | { kind: "alive" }
  | { kind: "qr"; qr: string }
  | { kind: "status"; status: SessionStatus; phoneNumber?: string; error?: string }
  | { kind: "message"; event: MessageEventPayload }
  | { kind: "ack"; externalId: string; ack: number }
  | { kind: "send-result"; requestId: string; ok: boolean; externalId?: string; error?: string };

/** IPC messages: supervisor -> session child process. */
export type ParentToChild = { kind: "send"; requestId: string; chatId: string; body: string } | { kind: "shutdown" };

/**
 * Child exit codes the supervisor treats specially.
 *   0  clean shutdown (supervisor asked, or the supervisor went away)
 *   2  the phone unlinked the device — restart promptly for a fresh QR, not counted as a crash
 *   4  the child asked for a fresh start (stale QR / scan timeout) — same handling, no status change
 *   any other non-zero: crash — restart with backoff, counted toward the crash-loop breaker
 */
export const EXIT_LOGGED_OUT = 2;
/** The child wants a fresh start (e.g. the QR code went stale, or a scan timed out) — restart promptly, not a crash. */
export const EXIT_RESTART = 4;
