import { describe, expect, it } from "vitest";
import { homeModulesFor, homeSpansFor } from "./modules";

describe("homeModulesFor", () => {
  it("never shows more than three modules", () => {
    for (const role of ["ADMIN", "MANAGER", "RM", "TEAM_MANAGER", "DEALER", "FINANCE"] as const) {
      expect(homeModulesFor(role).length).toBeLessThanOrEqual(3);
    }
  });
  it("puts the today queue in every desk role's home", () => {
    for (const role of ["ADMIN", "MANAGER", "RM"] as const) expect(homeModulesFor(role)).toContain("todayQueue");
  });
  it("gives RMs no team modules", () => {
    expect(homeModulesFor("RM")).not.toContain("teamPulse");
    expect(homeModulesFor("RM")).not.toContain("managerAttention");
  });

  it("spans fill exactly one 12-column row for every role", () => {
    for (const role of ["ADMIN", "MANAGER", "RM", "TEAM_MANAGER", "DEALER", "FINANCE"] as const) {
      const total = homeModulesFor(role).reduce((sum, m) => sum + homeSpansFor(role)[m], 0);
      expect(total).toBe(12);
    }
  });
});
