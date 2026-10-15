import type { ImpactReport } from "./impact";
import type { CustomerLine } from "./impact-db";
import type { Group } from "./model";

/**
 * Lead leakage: leads nobody reached, past their SLA, by campaign. Pure. A lead still inside its window is not a leak, and
 * the share leaked is out of the leads whose window has passed, so a busy morning does not look like a failing campaign.
 */

export type LeakItem = { clientId: string; name: string; rmName: string | null; stage: string; leadDate: string; minutesPastSla: number };
export type LeakGroup = { key: string; label: string; kind: Group["kind"]; leads: number; missed: number; leakRate: number | null; oldestMinutesPastSla: number; items: LeakItem[] };
export type Leakage = { total: number; groups: LeakGroup[]; byRm: { rmName: string; missed: number }[] };

export function buildLeakage(input: { report: ImpactReport; customers: Record<string, CustomerLine[]>; slaMinutes: number; now: Date }): Leakage {
  const groups: LeakGroup[] = [];
  const rmCounts = new Map<string, number>();
  for (const row of input.report.rows) {
    if (row.missed === 0) continue;
    const items: LeakItem[] = (input.customers[row.key] ?? [])
      .filter((c) => c.contact === "missed")
      .map((c) => ({ clientId: c.clientId, name: c.name, rmName: c.rmName, stage: c.stage, leadDate: c.leadDate, minutesPastSla: Math.max(0, Math.round((input.now.getTime() - Date.parse(c.createdAtIso)) / 60_000) - input.slaMinutes) }))
      .sort((a, b) => b.minutesPastSla - a.minutesPastSla);
    const resolved = row.contactedInSla + row.late + row.missed;
    groups.push({ key: row.key, label: row.label, kind: row.kind, leads: row.leads, missed: row.missed, leakRate: resolved > 0 ? row.missed / resolved : null, oldestMinutesPastSla: items[0]?.minutesPastSla ?? 0, items });
    for (const i of items) rmCounts.set(i.rmName ?? "Unassigned", (rmCounts.get(i.rmName ?? "Unassigned") ?? 0) + 1);
  }
  groups.sort((a, b) => b.missed - a.missed || b.oldestMinutesPastSla - a.oldestMinutesPastSla);
  const byRm = [...rmCounts.entries()].map(([rmName, missed]) => ({ rmName, missed })).sort((a, b) => b.missed - a.missed || (a.rmName === "Unassigned" ? 1 : b.rmName === "Unassigned" ? -1 : a.rmName.localeCompare(b.rmName)));
  return { total: input.report.totals.missed, groups, byRm };
}
