import crypto from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";

/** Delivery key for a webhook: the provider's own event id when it has one, else a hash of the raw body —
 * providers retry with an identical body, so the hash identifies a retry of the same delivery. */
export function deliveryKey(rawBody: string, providerEventId?: string | null): string {
  return providerEventId ? `id:${providerEventId}` : `sha256:${crypto.createHash("sha256").update(rawBody, "utf8").digest("hex")}`;
}

/** Records the delivery; false if it was already processed (a retry). Call only after authenticating it, so
 * unauthenticated junk can't fill the table. */
export async function claimWebhookDelivery(source: string, eventKey: string): Promise<boolean> {
  try {
    await prisma.webhookDelivery.create({ data: { source, eventKey } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

/** Processing failed after the claim: release it so the provider's retry is processed instead of skipped. */
export async function releaseWebhookDelivery(source: string, eventKey: string) {
  await prisma.webhookDelivery.deleteMany({ where: { source, eventKey } });
}

/** Cron housekeeping: retries arrive within hours, so a week of keys is plenty. */
export async function pruneSecurityTables(now = new Date()) {
  const [deliveries, counters] = await Promise.all([
    prisma.webhookDelivery.deleteMany({ where: { receivedAt: { lt: new Date(now.getTime() - 7 * 24 * 3600 * 1000) } } }),
    prisma.rateLimitCounter.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return { deliveries: deliveries.count, counters: counters.count };
}
