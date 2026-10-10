import { describe, expect, it } from "vitest";

import { summariseRmPerformance } from "./rm-performance-summary";

const row = (name: string, o: Partial<{ active: number; completed: number; rmSlaPct: number; capacity: number | null }> = {}) => ({ rm: { id: name, name, capacity: o.capacity ?? null }, active: 0, completed: 0, onHold: 0, overdueTasks: 0, rmOverdue: 0, rmSlaPct: 100, rmAvgDays: 0, ...o });

describe("summariseRmPerformance", () => {
  it("has no metrics to show when there are no RMs", () => {
    expect(summariseRmPerformance([])).toEqual({ metrics: [], leaders: [], hasData: false });
  });
  it("shows completion rate as no data when nothing has been worked yet, instead of 0%", () => {
    const s = summariseRmPerformance([row("A", { rmSlaPct: 64 })]);
    expect(s.metrics.find((m) => m.key === "completion")).toMatchObject({ value: null, empty: "No completed or active clients yet" });
    expect(s.metrics.find((m) => m.key === "sla")).toMatchObject({ value: 64 });
  });
  it("treats zero completions on a small base as too early, not 0%", () => {
    const s = summariseRmPerformance([row("A", { active: 12, completed: 0 })]);
    expect(s.metrics.find((m) => m.key === "completion")).toMatchObject({ value: null, empty: "No client has completed yet" });
  });
  it("shows a real 0% once there is a large enough base", () => {
    expect(summariseRmPerformance([row("A", { active: 60, completed: 0 })]).metrics.find((m) => m.key === "completion")?.value).toBe(0);
  });
  it("computes completion from completed over completed plus active", () => {
    const s = summariseRmPerformance([row("A", { active: 3, completed: 1 }), row("B", { active: 0, completed: 0 })]);
    expect(s.metrics.find((m) => m.key === "completion")?.value).toBe(25);
    expect(s.hasData).toBe(true);
  });
  it("adds capacity only when an RM has a capacity set", () => {
    expect(summariseRmPerformance([row("A", { active: 5 })]).metrics.some((m) => m.key === "capacity")).toBe(false);
    expect(summariseRmPerformance([row("A", { active: 5, capacity: 10 })]).metrics.find((m) => m.key === "capacity")?.value).toBe(50);
  });
  it("lists leaders by active clients, busiest first, at most five", () => {
    const rows = ["A", "B", "C", "D", "E", "F"].map((n, i) => row(n, { active: i }));
    const s = summariseRmPerformance(rows);
    expect(s.leaders.map((l) => l.name)).toEqual(["F", "E", "D", "C", "B"]);
  });
});
