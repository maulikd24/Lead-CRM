import { describe, expect, it } from "vitest";

import { isStageDone, stageLabel } from "./stage-label";

describe("stageLabel", () => {
  it("renames only the final stage, on screen", () => {
    expect(stageLabel("Onboarding Completed")).toBe("Handover Completed");
    expect(stageLabel("KYC completed")).toBe("KYC completed");
  });
});

describe("isStageDone", () => {
  const cur = (sequence: number, clientStatus = "ACTIVE") => ({ sequence, clientStatus });
  it("ticks earlier stages", () => expect(isStageDone({ name: "New Lead", sequence: 1 }, cur(3), false)).toBe(true));
  it("ticks KYC completed when the customer is on it", () => expect(isStageDone({ name: "KYC completed", sequence: 3 }, cur(3), false)).toBe(true));
  it("does not tick an in-progress current stage", () => {
    expect(isStageDone({ name: "Submitted for KYC", sequence: 2 }, cur(2), false)).toBe(false);
    expect(isStageDone({ name: "Pushed for funds", sequence: 4 }, cur(4), false)).toBe(false);
  });
  it("ticks the final stage once completed", () => {
    expect(isStageDone({ name: "Onboarding Completed", sequence: 6 }, cur(6, "COMPLETED"), true)).toBe(true);
    expect(isStageDone({ name: "Onboarding Completed", sequence: 6 }, cur(6, "ACTIVE"), true)).toBe(false);
  });
  it("never ticks a later stage", () => expect(isStageDone({ name: "KYC completed", sequence: 3 }, cur(2), false)).toBe(false));
});
