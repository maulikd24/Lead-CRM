import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  addDays,
  addWeeks,
  addMonths,
  addQuarters,
  addYears,
  format,
  getQuarter,
} from "date-fns";

import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type Granularity = "day" | "week" | "month" | "quarter" | "year";

export type LeadsActivityBucket = {
  key: string;
  label: string;
  periodStart: Date;
  periodEnd: Date;
  created: number;
  updated: number;
};

// Guards both the on-page chart and the CSV export against a runaway response (e.g. "Daily"
// granularity over a multi-year custom range) — same spirit as EXPORT_ROW_CAP in clients/export.
const MAX_BUCKETS = 500;

type GranularityFns = {
  startOf: (d: Date) => Date;
  add: (d: Date, n: number) => Date;
  label: (d: Date) => string;
};

// Every granularity goes through the exact same generic loop below — date-fns' symmetric
// startOf*/add* API means there's no meaningfully different code path for quarter/year vs day/week.
const GRANULARITY_FNS: Record<Granularity, GranularityFns> = {
  day: { startOf: startOfDay, add: (d, n) => addDays(d, n), label: (d) => format(d, "d MMM yyyy") },
  week: {
    startOf: (d) => startOfWeek(d, { weekStartsOn: 1 }),
    add: (d, n) => addWeeks(d, n),
    label: (d) => `Week of ${format(d, "d MMM yyyy")}`,
  },
  month: { startOf: startOfMonth, add: (d, n) => addMonths(d, n), label: (d) => format(d, "MMM yyyy") },
  quarter: { startOf: startOfQuarter, add: (d, n) => addQuarters(d, n), label: (d) => `Q${getQuarter(d)} ${format(d, "yyyy")}` },
  year: { startOf: startOfYear, add: (d, n) => addYears(d, n), label: (d) => format(d, "yyyy") },
};

/**
 * The single aggregation used by the Reports "Leads Activity" chart, its CSV export, the RM
 * detail page's personal trend, and the daily report email — nothing else duplicates this query
 * or the created/updated classification logic.
 */
export async function getLeadsActivity(params: {
  from: Date;
  to: Date;
  granularity: Granularity;
  clientWhere?: Prisma.ClientWhereInput;
}): Promise<LeadsActivityBucket[]> {
  const { from, to, granularity, clientWhere } = params;
  const { startOf, add, label } = GRANULARITY_FNS[granularity];

  const buckets: LeadsActivityBucket[] = [];
  let cursor = startOf(from);
  while (cursor <= to && buckets.length < MAX_BUCKETS) {
    const periodStart = cursor;
    const periodEnd = add(cursor, 1);
    buckets.push({ key: periodStart.toISOString(), label: label(periodStart), periodStart, periodEnd, created: 0, updated: 0 });
    cursor = periodEnd;
  }
  const bucketByKey = new Map(buckets.map((b) => [b.key, b]));
  const findBucket = (d: Date) => bucketByKey.get(startOf(d).toISOString());

  const rows = await prisma.client.findMany({
    where: {
      ...(clientWhere ?? {}),
      OR: [{ createdAt: { gte: from, lte: to } }, { updatedAt: { gte: from, lte: to } }],
    },
    select: { createdAt: true, updatedAt: true },
  });

  for (const row of rows) {
    if (row.createdAt >= from && row.createdAt <= to) {
      const b = findBucket(row.createdAt);
      if (b) b.created += 1;
    }
    if (row.updatedAt >= from && row.updatedAt <= to) {
      const b = findBucket(row.updatedAt);
      if (b) b.updated += 1;
    }
  }

  return buckets;
}

export type LeadsActivityParams = { granularity: Granularity; from: Date; to: Date };

const TRAILING_WINDOW: Record<Granularity, (now: Date) => Date> = {
  day: (now) => addDays(now, -30),
  week: (now) => addWeeks(now, -12),
  month: (now) => addMonths(now, -6),
  quarter: (now) => addQuarters(now, -8),
  year: (now) => addYears(now, -5),
};

/** Reads laGranularity/laFrom/laTo from either a plain params object (server component
 * searchParams) or URLSearchParams (the CSV route's request URL). "custom" always buckets by
 * day — there's no separate granularity control once an explicit range is picked. */
export function parseLeadsActivityParams(
  raw: Record<string, string | string[] | undefined> | URLSearchParams,
  now: Date,
): LeadsActivityParams {
  const get = (key: string): string | undefined => {
    if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
    const v = raw[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const granularityRaw = get("laGranularity");
  const fromRaw = get("laFrom");
  const toRaw = get("laTo");

  if (granularityRaw === "custom" && fromRaw && toRaw) {
    return { granularity: "day", from: new Date(fromRaw), to: new Date(`${toRaw}T23:59:59.999`) };
  }

  const granularity: Granularity = (["day", "week", "month", "quarter", "year"] as const).includes(
    granularityRaw as Granularity,
  )
    ? (granularityRaw as Granularity)
    : "month";

  return { granularity, from: TRAILING_WINDOW[granularity](now), to: now };
}
