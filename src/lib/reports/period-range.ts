import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, addWeeks, addMonths, addQuarters, format, getQuarter } from "date-fns";

import type { Granularity } from "@/lib/reports/leads-activity";

export type PeriodGranularity = "week" | "month" | "quarter";

type PeriodFns = {
  startOf: (d: Date) => Date;
  endOf: (d: Date) => Date;
  shift: (d: Date, n: number) => Date;
  label: (d: Date) => string;
};

// Mirrors leads-activity.ts's GRANULARITY_FNS table convention — one generic shape, one entry per
// granularity, no separate code path per period type.
const PERIOD_FNS: Record<PeriodGranularity, PeriodFns> = {
  week: {
    startOf: (d) => startOfWeek(d, { weekStartsOn: 1 }),
    endOf: (d) => endOfWeek(d, { weekStartsOn: 1 }),
    shift: (d, n) => addWeeks(d, n),
    label: (d) => `Week of ${format(startOfWeek(d, { weekStartsOn: 1 }), "d MMM yyyy")}`,
  },
  month: {
    startOf: startOfMonth,
    endOf: endOfMonth,
    shift: (d, n) => addMonths(d, n),
    label: (d) => format(d, "MMMM yyyy"),
  },
  quarter: {
    startOf: startOfQuarter,
    endOf: endOfQuarter,
    shift: (d, n) => addQuarters(d, n),
    label: (d) => `Q${getQuarter(d)} ${format(d, "yyyy")}`,
  },
};

export function resolvePeriodRange(granularity: PeriodGranularity, anchor: Date): { from: Date; to: Date } {
  const { startOf, endOf } = PERIOD_FNS[granularity];
  return { from: startOf(anchor), to: endOf(anchor) };
}

export function shiftPeriod(granularity: PeriodGranularity, anchor: Date, direction: 1 | -1): Date {
  return PERIOD_FNS[granularity].shift(anchor, direction);
}

export function formatPeriodLabel(granularity: PeriodGranularity, anchor: Date): string {
  return PERIOD_FNS[granularity].label(anchor);
}

/** Leads Activity's own bucket width, auto-chosen from the page-wide period's granularity — replaces
 * the chart's previous independent Daily/Weekly/Monthly/Custom picker on this one page. */
export function granularityForPeriod(periodGranularity: PeriodGranularity): Granularity {
  if (periodGranularity === "quarter") return "week";
  return "day";
}

export type ManagementPeriodParams = { granularity: PeriodGranularity; anchor: Date; from: Date; to: Date };

const VALID_GRANULARITIES: PeriodGranularity[] = ["week", "month", "quarter"];

export function parseManagementPeriodParams(
  raw: Record<string, string | string[] | undefined> | URLSearchParams,
  now: Date,
): ManagementPeriodParams {
  const get = (key: string): string | undefined => {
    if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
    const v = raw[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const granularityRaw = get("period");
  const granularity: PeriodGranularity = VALID_GRANULARITIES.includes(granularityRaw as PeriodGranularity)
    ? (granularityRaw as PeriodGranularity)
    : "month";

  const anchorRaw = get("anchor");
  const anchor = anchorRaw ? new Date(`${anchorRaw}T00:00:00`) : now;

  const { from, to } = resolvePeriodRange(granularity, anchor);
  return { granularity, anchor, from, to };
}
