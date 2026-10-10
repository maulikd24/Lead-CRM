import type { RmPerformanceRow } from "./rm-performance";

export type RmMetric = { key: "sla" | "capacity" | "completion"; label: string; /** null when there is not enough data to say. */ value: number | null; empty?: string };
export type RmLeader = { id: string; name: string; active: number; slaPct: number };
export type RmSummary = { metrics: RmMetric[]; leaders: RmLeader[]; hasData: boolean };

/** Below this many clients, zero completions is "too early", not a rate. */
const MIN_COMPLETION_BASE = 20;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pure. The Today-home RM card: a metric with no basis is null (shown as "no data yet"), never a misleading 0%. */
export function summariseRmPerformance(rows: readonly RmPerformanceRow[], topN = 5): RmSummary {
  if (rows.length === 0) return { metrics: [], leaders: [], hasData: false };
  const completed = rows.reduce((s, r) => s + r.completed, 0);
  const active = rows.reduce((s, r) => s + r.active, 0);
  const withCapacity = rows.filter((r) => r.rm.capacity != null && r.rm.capacity > 0);

  const metrics: RmMetric[] = [{ key: "sla", label: "SLA compliance", value: Math.round(mean(rows.map((r) => r.rmSlaPct))) }];
  if (withCapacity.length > 0) {
    metrics.push({ key: "capacity", label: "Capacity used", value: Math.round(mean(withCapacity.map((r) => Math.min(100, (r.active / (r.rm.capacity as number)) * 100)))) });
  }
  const base = completed + active;
  metrics.push(
    base === 0
      ? { key: "completion", label: "Completion rate", value: null, empty: "No completed or active clients yet" }
      : completed === 0 && base < MIN_COMPLETION_BASE
        ? { key: "completion", label: "Completion rate", value: null, empty: "No client has completed yet" }
        : { key: "completion", label: "Completion rate", value: Math.round((completed / base) * 100) },
  );

  const leaders = [...rows].sort((a, b) => b.active - a.active || a.rm.name.localeCompare(b.rm.name)).slice(0, topN).map((r) => ({ id: r.rm.id, name: r.rm.name, active: r.active, slaPct: r.rmSlaPct }));
  return { metrics, leaders, hasData: completed + active > 0 };
}
