import { describe, expect, it } from "vitest";

import { nextStepForViewer, type StageRow } from "./next-step";

const stages: StageRow[] = [
  { name: "New Lead", sequence: 1 },
  { name: "Submitted for KYC", sequence: 2 },
  { name: "KYC completed", sequence: 3 },
  { name: "Pushed for funds", sequence: 4 },
  { name: "Introduction with Dealer", sequence: 5 },
  { name: "Onboarding Completed", sequence: 6 },
];
const rm = { id: "rm-1", role: "RM" };
const base = { stages, currentSequence: 3, clientStatus: "ACTIVE" as const, viewer: rm, ownerId: "rm-1" };

describe("nextStepForViewer", () => {
  it("names the stage after KYC completed for the RM who owns the lead", () => {
    expect(nextStepForViewer(base)).toEqual({ stageName: "Pushed for funds", sequence: 4 });
  });
  it("is null for an RM looking at a lead they do not own", () => {
    expect(nextStepForViewer({ ...base, ownerId: "rm-2" })).toBeNull();
    expect(nextStepForViewer({ ...base, ownerId: null })).toBeNull();
  });
  it("lets a Manager or Admin see it for a lead they are allowed to open", () => {
    expect(nextStepForViewer({ ...base, viewer: { id: "m-1", role: "MANAGER" }, ownerId: "rm-2" })?.stageName).toBe("Pushed for funds");
    expect(nextStepForViewer({ ...base, viewer: { id: "a-1", role: "ADMIN" }, ownerId: null })?.stageName).toBe("Pushed for funds");
  });
  it("is null for held, lost or completed customers", () => {
    for (const clientStatus of ["ON_HOLD", "NOT_PROCEEDING", "COMPLETED"] as const) {
      expect(nextStepForViewer({ ...base, clientStatus })).toBeNull();
    }
  });
  it("is null at the final stage and never skips ahead past the next one", () => {
    expect(nextStepForViewer({ ...base, currentSequence: 6 })).toBeNull();
    expect(nextStepForViewer({ ...base, currentSequence: 2 })?.sequence).toBe(3);
  });
});
