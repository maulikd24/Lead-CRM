import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { dailyCounts } from "@/lib/dashboard/daily-counts";

/** Real history for sparklines and chart cards. Everything here reads existing timestamps; nothing is estimated. */

/** A running total on top of `base` (what existed before the window). */
export function cumulative(base: number, perDay: readonly number[]): number[] {
  let total = base;
  return perDay.map((n) => (total += n));
}

/** Rows per bucket of `bucketMs`, starting at `start`. A row outside the window is ignored. */
export function bucketCounts(dates: readonly Date[], start: Date, bucketMs: number, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const at of dates) {
    const i = Math.floor((at.getTime() - start.getTime()) / bucketMs);
    if (i >= 0 && i < n) out[i] += 1;
  }
  return out;
}

export function bucketSums(rows: readonly { at: Date; value: number }[], start: Date, bucketMs: number, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const r of rows) {
    const i = Math.floor((r.at.getTime() - start.getTime()) / bucketMs);
    if (i >= 0 && i < n) out[i] += r.value;
  }
  return out;
}

/** The start of the window of the same length that ends where a window starting at `start` begins. */
export function previousWindow(start: Date, windowMs: number): Date {
  return new Date(start.getTime() - windowMs);
}

const DAY = 86_400_000;

export type ClientHistory = {
  /** Clients created per local day, oldest first, today last. */
  created: number[];
  /** Clients that reached Completed per day. */
  completed: number[];
  /** Completed clients at the end of each day (running total; the figure the Completed tile shows, day by day). */
  completedTotal: number[];
};

/** The last `days` days of client creation and completion for the clients a viewer can see. */
export async function clientHistory(clientFilter: Prisma.ClientWhereInput, days = 14, now = new Date()): Promise<ClientHistory> {
  const since = new Date(now);
  since.setHours(0, 0, 0, 0);
  since.setTime(since.getTime() - (days - 1) * DAY);
  const [created, completed, completedBefore] = await Promise.all([
    prisma.client.findMany({ where: { ...clientFilter, createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.client.findMany({ where: { ...clientFilter, status: "COMPLETED", completedAt: { gte: since } }, select: { completedAt: true } }),
    prisma.client.count({ where: { ...clientFilter, status: "COMPLETED", completedAt: { lt: since } } }),
  ]);
  const perDay = dailyCounts(completed.flatMap((c) => (c.completedAt ? [c.completedAt] : [])), days, now);
  return {
    created: dailyCounts(created.map((c) => c.createdAt), days, now),
    completed: perDay,
    completedTotal: cumulative(completedBefore, perDay),
  };
}
