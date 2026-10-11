import { describe, expect, it } from "vitest";

import { AUTONOMY_LEVELS, assertAutonomy, autonomyViolations, levelRank, type AutonomyProfile } from "./autonomy";

const base: AutonomyProfile = { level: "L4", customerFacing: false, adSpend: false, internalReversible: false };

describe("autonomy ladder (owner-confirmed ceilings)", () => {
  it("has six levels in order", () => {
    expect(AUTONOMY_LEVELS).toEqual(["L0", "L1", "L2", "L3", "L4", "L5"]);
    expect(levelRank("L5")).toBeGreaterThan(levelRank("L4"));
  });

  it("customer-facing sends may be L3 (draft) or L4 (execute after human approval) only", () => {
    for (const level of AUTONOMY_LEVELS) {
      const v = autonomyViolations({ ...base, customerFacing: true, level });
      expect(v.length === 0, `customer-facing ${level}`).toBe(level === "L3" || level === "L4");
    }
  });

  it("ad spend changes are L4 at most", () => {
    expect(autonomyViolations({ ...base, adSpend: true, level: "L4" })).toEqual([]);
    expect(autonomyViolations({ ...base, adSpend: true, level: "L5", internalReversible: true })).not.toEqual([]);
  });

  it("L5 is only for internal, reversible, non-customer, non-spend actions", () => {
    expect(autonomyViolations({ ...base, level: "L5", internalReversible: true })).toEqual([]);
    expect(autonomyViolations({ ...base, level: "L5", internalReversible: false })).not.toEqual([]);
    expect(autonomyViolations({ ...base, level: "L5", internalReversible: true, customerFacing: true })).not.toEqual([]);
    expect(autonomyViolations({ ...base, level: "L5", internalReversible: true, adSpend: true })).not.toEqual([]);
  });

  it("assertAutonomy throws with the kind named", () => {
    expect(() => assertAutonomy("x-kind", { ...base, customerFacing: true, level: "L5" })).toThrow(/x-kind/);
    expect(() => assertAutonomy("x-kind", { ...base, customerFacing: true, level: "L4" })).not.toThrow();
  });
});
