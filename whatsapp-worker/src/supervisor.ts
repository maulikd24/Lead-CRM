import { fork, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import readline from "node:readline";

import { config } from "./config";
import type { EventPublisher, SessionStatus } from "./crm-client";
import { errorMessage, log, sleep } from "./log";
import { EXIT_LOGGED_OUT, EXIT_RESTART, type ChildToParent, type ParentToChild } from "./protocol";

export type SendResult = { ok: true; externalId: string } | { ok: false; error: string };

const ALIVE_TIMEOUT_MS = 60_000;
const STABLE_AFTER_MS = 5 * 60_000;
const CRASH_WINDOW_MS = 10 * 60_000;
const MAX_CRASHES_IN_WINDOW = 5;
const MAX_BACKOFF_MS = 5 * 60_000;
const SEND_TIMEOUT_MS = 60_000;

// When running from source (tsx) the child script is a .ts file and needs the tsx loader too.
const childExt = path.extname(__filename);
const childScript = path.join(__dirname, `session-child${childExt}`);
const childExecArgv = childExt === ".ts" ? ["--import", "tsx"] : [];

class SessionProcess {
  status: SessionStatus = "DISCONNECTED";
  phoneNumber?: string;

  private child: ChildProcess | null = null;
  private lastAlive = 0;
  private startedAt = 0;
  private consecutiveFailures = 0;
  private crashTimes: number[] = [];
  private restartTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private stopping = false;
  private halted = false;
  private lastPublished = "";
  private pending = new Map<string, { resolve: (r: SendResult) => void; timer: NodeJS.Timeout }>();
  private sendChain: Promise<unknown> = Promise.resolve();
  private lastSendAt = 0;

  constructor(
    readonly sessionId: string,
    private readonly publisher: EventPublisher,
  ) {}

  start() {
    if (this.stopping || this.halted || this.child) return;

    this.startedAt = Date.now();
    this.lastAlive = Date.now();
    this.publishStatus("CONNECTING");

    const child = fork(childScript, [], {
      env: { ...process.env, SESSION_ID: this.sessionId },
      execArgv: childExecArgv,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child = child;
    // Openwa v5's logger prints debug/info lines that include the page's console output. Forward only our own log
    // lines and Openwa's warn/error lines, so nothing customer-related can reach the container logs.
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]] as const) {
      if (!stream) continue;
      readline.createInterface({ input: stream }).on("line", (line) => {
        if (/^(debug|info|verbose|silly): /.test(line)) return;
        sink.write(`${line}\n`);
      });
    }
    log.info("Session process started", { session: this.sessionId, pid: child.pid });

    child.on("message", (message: ChildToParent) => this.onChildMessage(message));
    child.on("error", (error) => log.error("Session process error", { session: this.sessionId, error: errorMessage(error) }));
    child.on("exit", (code, signal) => this.onExit(code, signal));

    // A hung browser stops the child's 10s "alive" pings — kill it so the exit path restarts it.
    this.watchdog = setInterval(() => {
      if (this.child && Date.now() - this.lastAlive > ALIVE_TIMEOUT_MS) {
        log.error("Session process stopped responding — killing it", { session: this.sessionId });
        this.child.kill("SIGKILL");
      }
    }, 15_000);
  }

  private onChildMessage(message: ChildToParent) {
    this.lastAlive = Date.now();
    switch (message.kind) {
      case "alive":
        break;
      case "qr":
        this.publisher.enqueue({ type: "qr", sessionId: this.sessionId, qr: message.qr });
        if (this.status !== "CONNECTED") this.publishStatus("QR_PENDING");
        break;
      case "status":
        if (message.phoneNumber) this.phoneNumber = message.phoneNumber;
        if (message.status === "CONNECTED") this.consecutiveFailures = 0;
        this.publishStatus(message.status, message.error);
        break;
      case "message":
        this.publisher.enqueue(message.event);
        break;
      case "ack":
        this.publisher.enqueue({ type: "ack", sessionId: this.sessionId, externalId: message.externalId, ack: message.ack });
        break;
      case "send-result": {
        const entry = this.pending.get(message.requestId);
        if (!entry) break;
        clearTimeout(entry.timer);
        this.pending.delete(message.requestId);
        entry.resolve(message.ok && message.externalId ? { ok: true, externalId: message.externalId } : { ok: false, error: message.error ?? "Send failed" });
        break;
      }
    }
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null) {
    this.child = null;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;

    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: "WhatsApp session process exited" });
      this.pending.delete(id);
    }

    if (this.stopping) return;

    const lifetime = Date.now() - this.startedAt;
    log.warn("Session process exited", { session: this.sessionId, code, signal, lifetimeMs: lifetime });

    // Unlinked from the phone: restart soon for a fresh QR. Not a crash.
    if (code === EXIT_LOGGED_OUT) {
      this.publishStatus("DISCONNECTED", "Logged out from the phone — a new QR code is needed");
      this.scheduleRestart(5_000);
      return;
    }

    // The child recycled itself (stale QR / scan timeout): a normal part of waiting for a scan.
    if (code === EXIT_RESTART) {
      this.publishStatus("CONNECTING");
      this.scheduleRestart(2_000);
      return;
    }

    if (lifetime > STABLE_AFTER_MS) this.consecutiveFailures = 0;
    this.consecutiveFailures++;

    const now = Date.now();
    this.crashTimes = [...this.crashTimes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (this.crashTimes.length >= MAX_CRASHES_IN_WINDOW) {
      // Endlessly re-launching a session that keeps dying (e.g. a banned number) can make things worse.
      this.halted = true;
      this.publishStatus("FAILED", `Auto-restart paused after ${MAX_CRASHES_IN_WINDOW} crashes in 10 minutes — check the worker logs, then restart the worker`);
      log.error("Crash loop — restarts paused for this session until the worker is restarted", { session: this.sessionId });
      return;
    }

    this.publishStatus("FAILED", `Session process exited (code ${code ?? signal ?? "unknown"}) — restarting`);
    this.scheduleRestart(Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** (this.consecutiveFailures - 1)));
  }

  private scheduleRestart(delayMs: number) {
    if (this.stopping || this.halted) return;
    log.info("Scheduling session restart", { session: this.sessionId, inMs: delayMs });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, delayMs);
  }

  private publishStatus(status: SessionStatus, error?: string) {
    this.status = status;
    const key = `${status}|${error ?? ""}|${this.phoneNumber ?? ""}`;
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.publisher.enqueue({ type: "status", sessionId: this.sessionId, status, phoneNumber: this.phoneNumber, error });
  }

  /** Serialized per session with a minimum gap plus jitter — bursty, machine-regular sending is a ban signal. */
  send(chatId: string, body: string): Promise<SendResult> {
    const run = async (): Promise<SendResult> => {
      const wait = this.lastSendAt + config.sendMinIntervalMs - Date.now();
      if (wait > 0) await sleep(wait + Math.floor(Math.random() * 1_000));
      this.lastSendAt = Date.now();
      return this.dispatchSend(chatId, body);
    };
    const result = this.sendChain.then(run, run);
    this.sendChain = result.catch(() => undefined);
    return result;
  }

  private dispatchSend(chatId: string, body: string): Promise<SendResult> {
    if (!this.child || this.status !== "CONNECTED") {
      return Promise.resolve({ ok: false, error: "WhatsApp session is not connected" });
    }
    const requestId = crypto.randomUUID();
    return new Promise<SendResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, error: "Timed out waiting for WhatsApp to send the message" });
      }, SEND_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, timer });
      const message: ParentToChild = { kind: "send", requestId, chatId, body };
      this.child?.send(message);
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    const child = this.child;
    if (!child) return;

    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        child.kill("SIGKILL");
      }, 15_000);
      child.once("exit", () => {
        clearTimeout(force);
        resolve();
      });
      try {
        child.send({ kind: "shutdown" } satisfies ParentToChild);
      } catch {
        child.kill("SIGTERM");
      }
    });
  }
}

export class Supervisor {
  private sessions = new Map<string, SessionProcess>();

  constructor(private readonly publisher: EventPublisher) {
    for (const id of config.sessionIds) this.sessions.set(id, new SessionProcess(id, publisher));
  }

  /** Boot sessions one at a time: launching several Chromium instances at once spikes CPU/RAM. */
  async startAll(): Promise<void> {
    let first = true;
    for (const session of this.sessions.values()) {
      if (!first) await sleep(config.startStaggerMs);
      first = false;
      session.start();
    }
  }

  connectedSessionIds(): string[] {
    return [...this.sessions.values()].filter((s) => s.status === "CONNECTED").map((s) => s.sessionId);
  }

  snapshot(): { sessionId: string; status: SessionStatus }[] {
    return [...this.sessions.values()].map((s) => ({ sessionId: s.sessionId, status: s.status }));
  }

  send(sessionId: string, chatId: string, body: string): Promise<SendResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.resolve({ ok: false, error: `Unknown session ${sessionId}` });
    return session.send(chatId, body);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.stop()));
  }
}
