import { describe, expect, it } from "vitest";

import { runPlannerHealthJob } from "./job";

describe("the scheduled destination health check", () => {
  it("is a no-op while the planner flag is off", async () => {
    let ran = false;
    expect(await runPlannerHealthJob({ enabled: () => false, run: async () => { ran = true; return { checked: 1, unhealthy: 0 }; } })).toEqual({ skipped: "flag off" });
    expect(ran).toBe(false);
  });
  it("runs the checks and reports counts only when the planner is on", async () => {
    expect(await runPlannerHealthJob({ enabled: () => true, run: async () => ({ checked: 4, unhealthy: 1 }) })).toEqual({ checked: 4, unhealthy: 1 });
  });
  it("lets a failing run surface to runJob (which records it), so the control plane shows the failure", async () => {
    await expect(runPlannerHealthJob({ enabled: () => true, run: async () => { throw new Error("db down"); } })).rejects.toThrow("db down");
  });
});
