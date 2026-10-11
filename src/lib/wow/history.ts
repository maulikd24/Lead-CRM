import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { dailyCounts } from "@/lib/dashboard/daily-counts";

import { bucketCounts, cumulative, periodBuckets } from "./buckets";

export { bucketCounts, bucketSums, cumulative, periodBuckets, previousWindow } from "./buckets";

/** Real history for sparklines and chart cards. Everything here reads existing timestamps; nothing is estimated. */

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

export type PeriodHistory = {
  /** Bucket labels (a day each, or several days when the period is long). */
  labels: string[];
  created: number[];
  completed: number[];
  createdTotal: number;
  createdPrev: number;
  completedTotal: number;
  completedPrev: number;
};

/** Clients created and completed across a chosen period (the manager dashboard's), against the period of the same length before it. */
export async function periodHistory(clientFilter: Prisma.ClientWhereInput, from: Date, to: Date, now = new Date()): Promise<PeriodHistory> {
  const planned = periodBuckets(from, to);
  const bucketMs = planned.bucketMs;
  // A period that runs into the future has no data for the days to come: draw only up to today instead of a flat line of zeros.
  const n = Math.max(1, Math.min(planned.n, Math.ceil((Math.min(to.getTime(), now.getTime()) - from.getTime()) / bucketMs)));
  const len = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - len);
  const [created, completed, createdPrev, completedPrev] = await Promise.all([
    prisma.client.findMany({ where: { ...clientFilter, createdAt: { gte: from, lte: to } }, select: { createdAt: true } }),
    prisma.client.findMany({ where: { ...clientFilter, status: "COMPLETED", completedAt: { gte: from, lte: to } }, select: { completedAt: true } }),
    prisma.client.count({ where: { ...clientFilter, createdAt: { gte: prevFrom, lt: from } } }),
    prisma.client.count({ where: { ...clientFilter, status: "COMPLETED", completedAt: { gte: prevFrom, lt: from } } }),
  ]);
  const done = completed.flatMap((c) => (c.completedAt ? [c.completedAt] : []));
  return {
    labels: Array.from({ length: n }, (_, i) => new Date(from.getTime() + i * bucketMs).toLocaleDateString("en-IN", { day: "numeric", month: "short" })),
    created: bucketCounts(created.map((c) => c.createdAt), from, bucketMs, n),
    completed: bucketCounts(done, from, bucketMs, n),
    createdTotal: created.length,
    createdPrev,
    completedTotal: done.length,
    completedPrev,
  };
}
