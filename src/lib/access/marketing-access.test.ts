import { describe, expect, it } from "vitest";

import { canAccessMarketing } from "./marketing-access";

describe("canAccessMarketing", () => {
  it("is true only for ADMIN and MARKETING", () => {
    expect(canAccessMarketing("ADMIN")).toBe(true);
    expect(canAccessMarketing("MARKETING")).toBe(true);
  });
  it.each(["MANAGER", "RM", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "", "admin", "Marketing"])("is false for %s", (role) => {
    expect(canAccessMarketing(role)).toBe(false);
  });
});
