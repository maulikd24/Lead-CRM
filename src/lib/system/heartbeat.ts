import { prisma } from "@/lib/db/prisma";

export const CRON_HEARTBEAT = "cron_tick";
/** The scheduler should fire every ≤5 minutes; past this the tick is considered late. */
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000;

export async function recordHeartbeat(key: string, now = new Date()) {
  await prisma.systemHeartbeat.upsert({ where: { key }, update: { lastAt: now }, create: { key, lastAt: now } });
}

export async function getHeartbeatAgeMs(key: string, now = new Date()): Promise<number | null> {
  const row = await prisma.systemHeartbeat.findUnique({ where: { key } });
  return row ? now.getTime() - row.lastAt.getTime() : null;
}
