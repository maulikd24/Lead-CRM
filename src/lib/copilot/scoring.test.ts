import { describe, expect, it } from "vitest";

import { computeHealthStatus, computePriorityScore, withoutRepeatedReasons } from "./scoring";

describe("withoutRepeatedReasons", () => {
  it("drops the priority reasons that the health signal already says, and keeps the score", () => {
    const priority = computePriorityScore({ priority: "HIGH", slaStatus: "OVERDUE", overdueTaskCount: 2, daysSinceLastActivity: 8, clientStatus: "ACTIVE" });
    const health = computeHealthStatus({ slaStatus: "OVERDUE", stageAgeHours: 10, benchmarkAvgHours: null, daysSinceLastActivity: 8 });
    const out = withoutRepeatedReasons(priority, health);
    expect(out.score).toBe(priority.score);
    expect(out.reasons).toEqual(["2 overdue tasks", "High priority client"]);
    expect(health.reasons).toEqual(["Stage SLA overdue", "No activity in 8 days"]);
  });
  it("keeps every reason when the health signal has none of them", () => {
    const priority = computePriorityScore({ priority: "HIGH", slaStatus: "ON_TRACK", overdueTaskCount: 0, daysSinceLastActivity: 0, clientStatus: "ACTIVE" });
    const health = computeHealthStatus({ slaStatus: "ON_TRACK", stageAgeHours: 1, benchmarkAvgHours: null, daysSinceLastActivity: 0 });
    expect(withoutRepeatedReasons(priority, health).reasons).toEqual(["High priority client"]);
  });
});
