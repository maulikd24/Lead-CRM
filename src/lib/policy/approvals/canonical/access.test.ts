import { describe, expect, it } from "vitest";

import { ACTIONS, ALL_ROLES, can, rolesWith } from "@/lib/access/policy";

import { visibleKinds } from "./definitions";

describe("the inbox area and the per-kind rules agree", () => {
  it("exactly the roles that can see at least one kind can open the inbox, and nobody else (default deny)", () => {
    for (const role of ALL_ROLES) {
      if (role === "ADMIN") continue; // the superuser: every area
      expect(can(role, "approvals", "view"), `${role} view`).toBe(visibleKinds(role).length > 0);
      expect(can(role, "approvals", "manage"), `${role} manage`).toBe(visibleKinds(role).length > 0);
    }
  });

  it("the area is for approvers and requesters only, with no export", () => {
    expect(rolesWith("approvals")).toEqual(["ADMIN", "MANAGER", "RM", "FINANCE", "MARKETING"]);
    expect(rolesWith("approvals", "export")).toEqual(["ADMIN"]);
    expect(ACTIONS).toContain("export");
  });

  it("partner, dealer, distributor, affiliate and team-manager roles are refused outright", () => {
    for (const role of ["DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER"] as const) for (const action of ACTIONS) expect(can(role, "approvals", action), `${role} ${action}`).toBe(false);
  });
});
