import { describe, expect, it } from "vitest";

import { EMPTY_DRAFT, audienceFilter, draftSchema, scheduleIssue } from "./schema";
import { furthestReachable, parseStep, stepIssues, type StepContext } from "./steps";

const now = new Date("2026-10-20T10:00:00Z");
const ctx = (over: Partial<StepContext> = {}): StepContext => ({ consented: 12, templateVariables: ["offer"], now, ...over });
const ready = { ...EMPTY_DRAFT, name: "Diwali SIP nudge", templateId: "t1", variables: { offer: "zero entry load" } };

describe("Campaign Studio steps", () => {
  it("parses the step from the URL, defaulting to 1", () => {
    expect([parseStep("3"), parseStep(["2"]), parseStep("9"), parseStep(undefined), parseStep("x")]).toEqual([3, 2, 1, 1, 1]);
  });
  it("step 1 waits for the count and refuses an audience with nobody consented", () => {
    expect(stepIssues(1, ready, ctx({ consented: null }))).toEqual(["Counting the audience…"]);
    expect(stepIssues(1, ready, ctx({ consented: 0 }))[0]).toMatch(/Widen it/);
    expect(stepIssues(1, ready, ctx())).toEqual([]);
  });
  it("step 2 needs an approved template", () => {
    expect(stepIssues(2, { ...ready, templateId: "" }, ctx())).toHaveLength(1);
    expect(stepIssues(2, ready, ctx({ templateVariables: null }))).toHaveLength(1);
    expect(stepIssues(2, ready, ctx())).toEqual([]);
  });
  it("step 3 names every empty placeholder", () => {
    expect(stepIssues(3, { ...ready, variables: {} }, ctx({ templateVariables: ["name", "offer"] }))).toEqual(["Fill in {{name}}, {{offer}}."]);
  });
  it("step 4 needs a name and a future schedule, if any", () => {
    expect(stepIssues(4, { ...ready, name: "x" }, ctx())).toHaveLength(1);
    expect(stepIssues(4, { ...ready, scheduledFor: "2026-10-19T10:00" }, ctx())).toEqual(["Pick a send time in the future."]);
    expect(stepIssues(4, ready, ctx())).toEqual([]);
  });
  it("a deep link past an incomplete step lands on that step", () => {
    expect(furthestReachable(EMPTY_DRAFT, ctx())).toBe(2);
    expect(furthestReachable(ready, ctx())).toBe(4);
    expect(furthestReachable(ready, ctx({ consented: 0 }))).toBe(1);
  });
});

describe("broadcast draft schema", () => {
  it("accepts a complete draft and rejects a short name", () => {
    expect(draftSchema.safeParse(ready).success).toBe(true);
    expect(draftSchema.safeParse({ ...ready, name: "x" }).success).toBe(false);
    expect(draftSchema.safeParse({ ...ready, channel: "email" }).success).toBe(false);
  });
  it("turns the audience into /clients filters, leaving empty ones out", () => {
    expect(audienceFilter({ status: "ACTIVE", stage: "", segment: "high-value", leadSource: "" })).toEqual({ status: "ACTIVE", segment: "high-value" });
  });
  it("checks the schedule", () => {
    expect(scheduleIssue("", now)).toBeNull();
    expect(scheduleIssue("nope", now)).toMatch(/valid/);
  });
});
