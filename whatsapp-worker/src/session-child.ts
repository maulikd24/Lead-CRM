// One Openwa session in its own OS process. The supervisor (supervisor.ts) forks one of these per
// WhatsApp number so that a crash or hang in one browser can only ever take down the one number it concerns.
//
// Engine: Openwa v5 alpha (@open-wa/core + @open-wa/client + @open-wa/driver-puppeteer), pinned exactly.
import { createClient, type OpenWAClient } from "@open-wa/core";
import { PuppeteerDriver } from "@open-wa/driver-puppeteer";
import { Client } from "@open-wa/client";
import QRCode from "qrcode";

import { config } from "./config";
import { errorMessage, log, sleep } from "./log";
import { mapSessionState, toAck, toMessageEvent, type WaMessage } from "./handlers";
import { EXIT_LOGGED_OUT, EXIT_RESTART, type ChildToParent, type ParentToChild } from "./protocol";
import type { SessionStatus } from "./crm-client";

const sessionId = process.env.SESSION_ID;
if (!sessionId) {
  console.error("session-child started without SESSION_ID");
  process.exit(1);
}
if (!process.send) {
  console.error("session-child must be started by the supervisor (no IPC channel)");
  process.exit(1);
}

const sid: string = sessionId;
const post = (message: ChildToParent) => process.send?.(message);

/**
 * How the QR code is read. Openwa v5 alpha.8 emits `launch.auth.qr.generated` once and never re-emits, but
 * WhatsApp Web rotates the code in the page, so we read it straight from the DOM (this is the same selector
 * Openwa itself uses) and forward every change. The value is a link (https://wa.me/settings/linked_devices#…).
 */
const QR_SCRIPT = `document.querySelector("canvas[aria-label]")?.parentElement?.getAttribute("data-ref") || null`;
const QR_POLL_MS = 5_000;
// Re-send an unchanged QR this often so the CRM (which treats a QR older than 90s as stale) keeps showing it.
const QR_KEEPALIVE_MS = 30_000;
// If nobody scans and the code never changes for this long, recycle the browser for a fresh one.
const QR_MAX_UNCHANGED_MS = 10 * 60_000;
// v5 treats qrTimeoutMs/authTimeoutMs = 0 as "use the 60s default" for the scan wait (verified in the source),
// so "wait a long time" has to be a real number. The scan wait is 2x qrTimeoutMs; a timeout just recycles the session.
const QR_TIMEOUT_MS = 6 * 60 * 60_000;
const AUTH_TIMEOUT_MS = 12 * 60 * 60_000;

let core: OpenWAClient | null = null;
let client: Client | null = null;
let currentStatus: SessionStatus = "CONNECTING";
let shuttingDown = false;
let authenticated = false;

function setStatus(status: SessionStatus, extra: { phoneNumber?: string; error?: string } = {}) {
  currentStatus = status;
  post({ kind: "status", status, ...extra });
}

function launchOptions() {
  return {
    sessionId: sid,
    driver: new PuppeteerDriver(),
    headless: true,
    ...(config.chromePath ? { executablePath: config.chromePath } : {}),
    // v5 keeps one browser profile per sessionId under here (an `_IGNORE_<sessionId>` folder), which is what
    // lets a restart reconnect without a new QR scan. Mount it as a volume.
    sessionDataPath: config.sessionDataDir,
    qrTimeoutMs: QR_TIMEOUT_MS,
    authTimeoutMs: AUTH_TIMEOUT_MS,
    // Lifecycle is owned by the supervisor.
    killClientOnLogout: true,
    deleteSessionDataOnLogout: true,
    // Deliberately NOT set: patchConfig (downloads remote patches from cdn.openwa.dev and runs them inside
    // the page that controls the WhatsApp account), licenseKey/licenseConfig (phones home to openwa.dev),
    // watermark, logConsole (would copy the page's console into our logs).
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([promise, sleep(ms).then(() => Promise.reject(new Error(`${label} timed out after ${ms}ms`)))]);
}

async function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (client) await withTimeout(client.stop("shutdown"), 10_000, "client.stop");
    else if (core) await withTimeout(core.stop("shutdown"), 10_000, "core.stop");
  } catch (error) {
    log.warn("stop failed during shutdown", { session: sid, error: errorMessage(error) });
  }
  process.exit(code);
}

async function handleSend(requestId: string, chatId: string, body: string) {
  if (!client || currentStatus !== "CONNECTED") {
    post({ kind: "send-result", requestId, ok: false, error: "WhatsApp session is not connected" });
    return;
  }
  try {
    const result = await withTimeout(client.sendText(chatId as never, body), 45_000, "sendText");
    if (typeof result === "string" && result.length > 0) {
      post({ kind: "send-result", requestId, ok: true, externalId: result });
    } else {
      post({ kind: "send-result", requestId, ok: false, error: `WhatsApp did not accept the message (${String(result)})` });
    }
  } catch (error) {
    post({ kind: "send-result", requestId, ok: false, error: errorMessage(error).slice(0, 300) });
  }
}

process.on("message", (message: ParentToChild) => {
  if (message.kind === "send") void handleSend(message.requestId, message.chatId, message.body);
  else if (message.kind === "shutdown") void shutdown(0);
});
// If the supervisor dies, don't leave an orphaned Chromium running.
process.on("disconnect", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));

// Stray puppeteer/Openwa rejections must not silently kill the process without a trace.
process.on("unhandledRejection", (reason) => log.error("Unhandled rejection in session process", { session: sid, error: errorMessage(reason) }));

// ---- QR handling ---------------------------------------------------------------------------------------------

let lastQr: string | null = null;
let lastQrChangeAt = 0;
let lastQrSentAt = 0;
let qrTimer: NodeJS.Timeout | null = null;

async function publishQr(raw: string) {
  const now = Date.now();
  const changed = raw !== lastQr;
  if (changed) {
    lastQr = raw;
    lastQrChangeAt = now;
  } else if (now - lastQrSentAt < QR_KEEPALIVE_MS) {
    return;
  }
  lastQrSentAt = now;
  try {
    // The CRM shows an image; the page only gives us the link the QR encodes, so render it here.
    const dataUrl = await QRCode.toDataURL(raw, { errorCorrectionLevel: "L", margin: 2, width: 320 });
    post({ kind: "qr", qr: dataUrl });
    if (changed) log.info("QR code updated", { session: sid });
  } catch (error) {
    log.warn("Could not render the QR code", { session: sid, error: errorMessage(error) });
  }
}

function startQrPolling() {
  qrTimer = setInterval(async () => {
    if (!core || authenticated || shuttingDown) return;
    try {
      const raw = await withTimeout(core.evaluateScript<string>(QR_SCRIPT), 10_000, "QR read");
      if (typeof raw === "string" && raw.length > 20) {
        await publishQr(raw);
      }
    } catch {
      // The page may be mid-navigation; the next tick retries.
    }
    if (lastQr && Date.now() - lastQrChangeAt > QR_MAX_UNCHANGED_MS) {
      log.warn("QR code unchanged and unscanned for too long — recycling the browser", { session: sid });
      void shutdown(EXIT_RESTART);
    }
  }, QR_POLL_MS);
  qrTimer.unref?.();
}

// ---- main ---------------------------------------------------------------------------------------------------

async function main() {
  setStatus("CONNECTING");

  core = await createClient(launchOptions());
  // The v5 logger is chatty (page console lines, injection traces) — keep the container logs to warnings.
  (core.logger as { setLevel?: (level: string) => void }).setLevel?.("warn");

  core.events.onAny((event: string, payload: unknown) => {
    const details = (payload as { details?: Record<string, unknown> } | null)?.details ?? {};
    if (event === "launch.auth.qr.generated" && typeof details.qr === "string") {
      void publishQr(details.qr);
    } else if (event === "session.state.changed") {
      const mapped = mapSessionState(String(details.next));
      // READY is reported after we have the host number (below); the others can be forwarded as-is.
      if (mapped && mapped.status !== "CONNECTED" && authenticated) {
        setStatus(mapped.status, mapped.error ? { error: mapped.error } : {});
      } else if (mapped && !authenticated && mapped.status === "CONNECTING" && currentStatus !== "CONNECTING") {
        setStatus("CONNECTING");
      }
    }
  });

  const wa = new Client({ client: core, transport: core.getTransport() });
  client = wa;

  startQrPolling();

  try {
    await wa.start();
  } catch (error) {
    // Stopping the client mid-launch (SIGTERM, stale-QR recycle) makes start() reject; that is not a failure.
    if (shuttingDown) return;
    const message = errorMessage(error);
    if (/QR scan took too long|qr_timeout/i.test(message)) {
      log.info("QR scan window elapsed — restarting for a fresh code", { session: sid });
      await shutdown(EXIT_RESTART);
      return;
    }
    throw error;
  }
  authenticated = true;
  if (qrTimer) clearInterval(qrTimer);

  // Bind the message/ack/state listeners. If this fails the session would look connected but be deaf, so treat it as a crash.
  await withTimeout(wa.loaded(), 120_000, "client.loaded");

  let phoneNumber: string | undefined;
  try {
    phoneNumber = (await wa.getHostNumber()).replace(/\D/g, "") || undefined;
  } catch (error) {
    log.warn("Could not read host number", { session: sid, error: errorMessage(error) });
  }
  setStatus("CONNECTED", { phoneNumber });
  log.info("Session connected", { session: sid });

  wa.onAnyMessage((message) => {
    const event = toMessageEvent(sid, message as unknown as WaMessage);
    if (event) post({ kind: "message", event });
  });

  wa.onAck((payload) => {
    const ack = toAck(payload);
    if (ack) post({ kind: "ack", ...ack });
  });

  wa.onStateChanged((state) => {
    const mapped = mapSessionState(String(state));
    if (mapped) setStatus(mapped.status, mapped.error ? { error: mapped.error } : {});
  });

  wa.onLogout(() => {
    setStatus("DISCONNECTED", { error: "Logged out from the phone — a new QR code is needed" });
    void shutdown(EXIT_LOGGED_OUT);
  });

  setInterval(() => post({ kind: "alive" }), 10_000).unref?.();

  let failures = 0;
  setInterval(async () => {
    if (!core || shuttingDown) return;
    try {
      // A trivial evaluate proves the browser is still responding.
      await withTimeout(core.evaluateScript("true"), 20_000, "browser probe");
      failures = 0;
      const mapped = mapSessionState(core.getState());
      if (mapped && mapped.status !== currentStatus) setStatus(mapped.status, mapped.error ? { error: mapped.error } : {});
    } catch (error) {
      failures++;
      log.warn("Health check failed", { session: sid, failures, error: errorMessage(error) });
      if (failures >= 2) {
        setStatus("FAILED", { error: "Browser stopped responding" });
        void shutdown(3);
      }
    }
  }, config.healthCheckMs).unref?.();
}

main().catch((error) => {
  log.error("Session failed to start", { session: sid, error: errorMessage(error) });
  setStatus("FAILED", { error: errorMessage(error).slice(0, 300) });
  // Give the status IPC message a moment to flush before exiting.
  setTimeout(() => process.exit(1), 300);
});
