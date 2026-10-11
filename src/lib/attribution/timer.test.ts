import { describe, expect, it } from "vitest";

import { speedTimer } from "./timer";

const due = new Date("2027-03-02T05:15:00Z").getTime();

describe("speedTimer", () => {
  it("counts down to the SLA, then up past it", () => {
    expect(speedTimer(due, due - 11 * 60_000)).toEqual({ state: "running", label: "11 min left", urgent: false });
    expect(speedTimer(due, due - 4 * 60_000)).toEqual({ state: "running", label: "4 min left", urgent: true });
    expect(speedTimer(due, due - 20_000)).toEqual({ state: "running", label: "under a minute left", urgent: true });
    expect(speedTimer(due, due + 42 * 60_000)).toEqual({ state: "breached", label: "42 min past the SLA", urgent: true });
    expect(speedTimer(due, due + 3 * 3_600_000)).toEqual({ state: "breached", label: "3 h past the SLA", urgent: true });
  });
  it("exactly at the deadline is still running (the SLA is 'within')", () => {
    expect(speedTimer(due, due).state).toBe("running");
  });
});
