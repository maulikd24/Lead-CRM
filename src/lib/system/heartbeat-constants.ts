/** Prisma-free copies of the heartbeat constants (heartbeat.ts imports the database), so pure code and tests can use them. */
export const CRON_HEARTBEAT = "cron_tick";
/** The scheduler should fire every 5 minutes or so; past this the tick is considered late. */
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000;
