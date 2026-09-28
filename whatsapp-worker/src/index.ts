import { execFileSync } from "node:child_process";

import { config } from "./config";
import { claimOutbox, EventPublisher, reportOutboxResult } from "./crm-client";
import { errorMessage, log } from "./log";
import { Supervisor } from "./supervisor";

/** Openwa v5 loads a native-backed session compressor at import time and refuses to start without the `zstd` binary. */
function assertPrerequisites() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) throw new Error(`Node.js 22 or newer is required (running ${process.versions.node})`);
  try {
    execFileSync("zstd", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("The `zstd` command-line tool is required by Openwa v5 but was not found on PATH (Debian/Ubuntu: apt-get install zstd, macOS: brew install zstd)");
  }
}

async function main() {
  assertPrerequisites();
  log.info("Starting WhatsApp worker", { sessions: config.sessionIds, crm: config.crmBaseUrl });

  const publisher = new EventPublisher();
  const supervisor = new Supervisor(publisher);

  // Heartbeat: the CRM marks a number offline if these stop for 5 minutes.
  const heartbeat = setInterval(() => publisher.enqueue({ type: "heartbeat", sessions: supervisor.snapshot() }), config.heartbeatMs);
  publisher.enqueue({ type: "heartbeat", sessions: supervisor.snapshot() });

  // Outbox: claim CRM-queued replies and hand each to its session process.
  let polling = false;
  const outbox = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const items = await claimOutbox(supervisor.connectedSessionIds());
      for (const item of items) {
        void supervisor.send(item.sessionId, item.chatId, item.body).then((result) =>
          reportOutboxResult(item.id, result.ok ? { ok: true, externalId: result.externalId } : { ok: false, error: result.error }),
        );
      }
    } catch (error) {
      log.warn("Outbox poll failed", { error: errorMessage(error) });
    } finally {
      polling = false;
    }
  }, config.outboxPollMs);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("Shutting down", { signal });
    clearInterval(heartbeat);
    clearInterval(outbox);
    await supervisor.shutdown();
    await publisher.drain(5_000);
    publisher.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // The supervisor is a thin coordinator; a stray rejection should be visible, not fatal to every number.
  process.on("unhandledRejection", (reason) => log.error("Unhandled rejection", { error: errorMessage(reason) }));
  process.on("uncaughtException", (error) => log.error("Uncaught exception", { error: errorMessage(error) }));

  await supervisor.startAll();
  log.info("All session processes launched — scan QR codes from Settings → WhatsApp Accounts in the CRM");
}

main().catch((error) => {
  log.error("Worker failed to start", { error: errorMessage(error) });
  process.exit(1);
});
