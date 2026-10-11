import { DEFAULT_THRESHOLDS, type Thresholds } from "./thresholds";
import { sum } from "./stats";
import type { AutopilotSnapshot } from "./types";

/** Monthly pacing: spend so far against the month's plan, with a projected month-end. Pure. */

export type PacingFlag = "on_track" | "overspend" | "underspend" | "no_plan" | "too_early" | "no_data";

export type PacingRow = {
  campaignId: string;
  campaignName: string;
  planned: number | null;
  spendToDate: number;
  /** Month-end projection: spend to date plus the last seven days' average for each remaining day. */
  projected: number | null;
  /** projected / planned - 1 (0.12 = 12% over plan). */
  variance: number | null;
  flag: PacingFlag;
};

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** `today` is the last day the data covers (YYYY-MM-DD); pacing is for the calendar month that day sits in. */
export function monthlyPacing(s: AutopilotSnapshot, today: string, t: Thresholds = DEFAULT_THRESHOLDS): PacingRow[] {
  const [y, m, d] = today.split("-").map(Number);
  const prefix = today.slice(0, 7);
  const dim = daysInMonth(y, m);
  const remaining = dim - d;
  return s.campaigns.map((c) => {
    const rows = s.days.filter((r) => r.campaignId === c.id);
    const mtd = sum(rows.filter((r) => r.date.startsWith(prefix) && r.date <= today).map((r) => r.spend));
    const base = { campaignId: c.id, campaignName: c.name, planned: c.plannedMonthlyBudget, spendToDate: mtd };
    if (rows.length === 0) return { ...base, projected: null, variance: null, flag: "no_data" as const };
    if (c.plannedMonthlyBudget === null || c.plannedMonthlyBudget <= 0) return { ...base, projected: null, variance: null, flag: "no_plan" as const };
    if (d < t.pacingMinDays) return { ...base, projected: null, variance: null, flag: "too_early" as const };
    const recent = rows.filter((r) => r.date <= today).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);
    const dailyAvg = recent.length ? sum(recent.map((r) => r.spend)) / recent.length : 0;
    const projected = mtd + dailyAvg * remaining;
    const variance = projected / c.plannedMonthlyBudget - 1;
    const flag: PacingFlag = variance > t.pacingOverTolerance ? "overspend" : variance < -t.pacingUnderTolerance ? "underspend" : "on_track";
    return { ...base, projected, variance, flag };
  });
}
