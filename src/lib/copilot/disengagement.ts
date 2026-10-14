import type { Prisma } from "@/generated/prisma/client";

/** A live client with no activity, message or other contact for this many days is "disengaged". One number for the daily check, the Co-pilot count and the Clients filter. */
export const DISENGAGED_AFTER_DAYS = 5;

export const disengagedCutoff = (now: Date = new Date()): Date => new Date(now.getTime() - DISENGAGED_AFTER_DAYS * 24 * 60 * 60 * 1000);

/** The one disengaged query: a live client nothing was logged or sent for since the cutoff, and not created after it. The Clients tab, the Co-pilot count and the daily check all use it. */
export function disengagedWhere(now: Date = new Date()): Prisma.ClientWhereInput {
  const cutoff = disengagedCutoff(now);
  return { status: "ACTIVE", isDeleted: false, createdAt: { lt: cutoff }, activities: { none: { createdAt: { gte: cutoff } } }, messages: { none: { createdAt: { gte: cutoff } } } };
}
