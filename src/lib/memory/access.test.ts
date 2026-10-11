import { describe, expect, it } from "vitest";

import { ALL_ROLES, can } from "@/lib/access/policy";

import { canManageMemory, canSeeMemory } from "./access";

describe("memory, service state and household intelligence are registered, default deny", () => {
  it("RM and MANAGER view and manage customer memory and service state; ADMIN everything; nobody else", () => {
    for (const area of ["customer-memory", "service-state"] as const) {
      for (const role of ALL_ROLES) {
        const allowed = role === "ADMIN" || role === "RM" || role === "MANAGER";
        expect(can(role, area, "view"), `${role} ${area} view`).toBe(allowed);
        expect(can(role, area, "manage"), `${role} ${area} manage`).toBe(allowed);
        expect(can(role, area, "export"), `${role} ${area} export`).toBe(role === "ADMIN");
      }
    }
  });
  it("MARKETING sees no memory, no service state and no household intelligence", () => {
    for (const area of ["customer-memory", "service-state", "household-intelligence"] as const) for (const a of ["view", "manage", "export"] as const) expect(can("MARKETING", area, a)).toBe(false);
  });
  it("household intelligence is for managers and admins only: an RM does not get the household summary", () => {
    for (const role of ALL_ROLES) expect(can(role, "household-intelligence", "view"), role).toBe(role === "ADMIN" || role === "MANAGER");
  });
});

describe("record-level visibility: an RM sees the memory of own customers only; a manager of the team; admin all", () => {
  const client = (assignedToId: string | null) => ({ assignedToId, isDeleted: false, mergedIntoId: null });
  it("RM: own customer yes, someone else's no, unassigned no", () => {
    expect(canSeeMemory("RM", ["rm1"], client("rm1"))).toBe(true);
    expect(canSeeMemory("RM", ["rm1"], client("rm2"))).toBe(false);
    expect(canSeeMemory("RM", ["rm1"], client(null))).toBe(false);
  });
  it("MANAGER: team members' customers yes, outside the team no, unassigned yes (they assign it)", () => {
    expect(canSeeMemory("MANAGER", ["m1", "rm1"], client("rm1"))).toBe(true);
    expect(canSeeMemory("MANAGER", ["m1", "rm1"], client("rm9"))).toBe(false);
    expect(canSeeMemory("MANAGER", ["m1", "rm1"], client(null))).toBe(true);
  });
  it("ADMIN: everyone (visibleUserIds null)", () => {
    expect(canSeeMemory("ADMIN", null, client("rm9"))).toBe(true);
  });
  it("MARKETING and every role without the area: nobody, whatever scope they are handed", () => {
    for (const role of ["MARKETING", "FINANCE", "DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER"]) expect(canSeeMemory(role, null, client("rm1")), role).toBe(false);
    expect(canSeeMemory("MARKETING", [], client("rm1"))).toBe(false);
  });
  it("a merged customer is not found; an archived one is for ADMIN only", () => {
    expect(canSeeMemory("ADMIN", null, { assignedToId: "rm1", isDeleted: false, mergedIntoId: "x" })).toBe(false);
    expect(canSeeMemory("RM", ["rm1"], { assignedToId: "rm1", isDeleted: true, mergedIntoId: null })).toBe(false);
    expect(canSeeMemory("ADMIN", null, { assignedToId: "rm1", isDeleted: true, mergedIntoId: null })).toBe(true);
  });
  it("manage follows the same record rule", () => {
    expect(canManageMemory("RM", ["rm1"], client("rm1"))).toBe(true);
    expect(canManageMemory("RM", ["rm1"], client("rm2"))).toBe(false);
    expect(canManageMemory("MARKETING", [], client("rm1"))).toBe(false);
  });
});
