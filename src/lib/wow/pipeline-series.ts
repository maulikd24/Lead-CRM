import type { OpportunityStage, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { computeDelta, type Delta } from "@/components/wow/wow-logic";

import { bucketCounts, bucketSums, previousWindow } from "./buckets";

export type PipelineRange = "today" | "week" | "quarter";

type Config = { windowDays: number; buckets: number; label: "time" | "weekday" | "date" };
export const RANGE_CONFIG: Record<PipelineRange, Config> = {
  today: { windowDays: 1, buckets: 6, label: "time" },
  week: { windowDays: 7, buckets: 7, label: "weekday" },
  quarter: { windowDays: 90, buckets: 12, label: "date" },
};

export const OPEN_STAGES: OpportunityStage[] = ["IDENTIFIED", "DISCUSSED", "INTERESTED", "RECOMMENDATION", "DECISION_PENDING", "COMMITTED", "FUNDED"];

function labelFor(kind: Config["label"], d: Date): string {
  if (kind === "time") return d.toLocaleTimeString("en-IN", { hour: "numeric", hour12: true }).toLowerCase();
  if (kind === "weekday") return d.toLocaleDateString("en-IN", { weekday: "short" });
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export type PipelineSeries = {
  labels: string[];
  value: number[];
  opportunities: number[];
  clients: number[];
  /** Change of each series against the previous window of the same length (null when that window was empty). */
  delta: { value: Delta | null; opportunities: Delta | null; clients: Delta | null };
  openCount: number;
  openValue: number;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * What opened in the window, by bucket, for the three series on the pipeline chart: value of new opportunities, number of new
 * opportunities, and new clients. Each is compared with the window just before it, so "vs last period" is a real figure.
 */
export async function pipelineSeries(clientFilter: Prisma.ClientWhereInput, range: PipelineRange, now = new Date()): Promise<PipelineSeries> {
  const cfg = RANGE_CONFIG[range];
  const windowMs = cfg.windowDays * 86_400_000;
  const bucketMs = windowMs / cfg.buckets;
  const start = new Date(now.getTime() - windowMs);
  const prevStart = previousWindow(start, windowMs);

  const [opps, openOpps, clients] = await Promise.all([
    prisma.opportunity.findMany({ where: { createdAt: { gte: prevStart }, stage: { in: OPEN_STAGES }, client: clientFilter }, select: { createdAt: true, estimatedValue: true } }),
    prisma.opportunity.aggregate({ where: { stage: { in: OPEN_STAGES }, client: clientFilter }, _count: true, _sum: { estimatedValue: true } }),
    prisma.client.findMany({ where: { ...clientFilter, createdAt: { gte: prevStart } }, select: { createdAt: true } }),
  ]);
  const oppRows = opps.map((o) => ({ at: o.createdAt, value: Number(o.estimatedValue) }));
  const inWindow = <T extends { at: Date }>(rows: T[]) => rows.filter((r) => r.at >= start);
  const before = <T extends { at: Date }>(rows: T[]) => rows.filter((r) => r.at < start);

  const value = bucketSums(inWindow(oppRows), start, bucketMs, cfg.buckets);
  const opportunities = bucketCounts(inWindow(oppRows).map((r) => r.at), start, bucketMs, cfg.buckets);
  const clientRows = clients.map((c) => ({ at: c.createdAt }));
  const newClients = bucketCounts(inWindow(clientRows).map((r) => r.at), start, bucketMs, cfg.buckets);

  return {
    labels: Array.from({ length: cfg.buckets }, (_, i) => labelFor(cfg.label, new Date(start.getTime() + i * bucketMs))),
    value,
    opportunities,
    clients: newClients,
    delta: {
      value: computeDelta(sum(value), sum(before(oppRows).map((r) => r.value))),
      opportunities: computeDelta(sum(opportunities), before(oppRows).length),
      clients: computeDelta(sum(newClients), before(clientRows).length),
    },
    openCount: openOpps._count,
    openValue: Number(openOpps._sum.estimatedValue ?? 0),
  };
}
