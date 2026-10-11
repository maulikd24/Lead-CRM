import { prisma } from "@/lib/db/prisma";

import { CRON_HEARTBEAT, HEARTBEAT_STALE_MS } from "./heartbeat-constants";

export { CRON_HEARTBEAT, HEARTBEAT_STALE_MS };

export async function recordHeartbeat(key: string, now = new Date()) {
  await prisma.systemHeartbeat.upsert({ where: { key }, update: { lastAt: now }, create: { key, lastAt: now } });
}

export async function getHeartbeatAgeMs(key: string, now = new Date()): Promise<number | null> {
  const row = await prisma.systemHeartbeat.findUnique({ where: { key } });
  return row ? now.getTime() - row.lastAt.getTime() : null;
}

export const CRON_TICK_LOCK = "cron_tick_lock";

/** Lease lock on a SystemHeartbeat row, whose lastAt here means "held until". One atomic statement: a free or
 * expired lease is taken, a live one isn't. Expiry makes a crashed holder's lock free itself — so set leaseMs to
 * at least the holder's maximum runtime. Returns false if someone else holds it. */
export async function claimLease(key: string, leaseMs: number, now = new Date()): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "SystemHeartbeat" ("key", "lastAt") VALUES (${key}, ${new Date(now.getTime() + leaseMs)})
    ON CONFLICT ("key") DO UPDATE SET "lastAt" = EXCLUDED."lastAt"
    WHERE "SystemHeartbeat"."lastAt" < ${now}
    RETURNING "key"`;
  return rows.length > 0;
}

export async function releaseLease(key: string, now = new Date()) {
  await prisma.systemHeartbeat.updateMany({ where: { key }, data: { lastAt: now } });
}
