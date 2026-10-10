import { describe, expect, it } from "vitest";

import { HOME_TABS, homeTabsFor } from "./tabs";

const keys = (role: Parameters<typeof homeTabsFor>[0], view: Parameters<typeof homeTabsFor>[1]) => homeTabsFor(role, view).map((t) => t.key);

describe("homeTabsFor", () => {
  it("full dashboard: My day and Pipeline for everyone, Team for everyone but RMs", () => {
    expect(keys("RM", "full")).toEqual(["myday", "pipeline"]);
    expect(keys("MANAGER", "full")).toEqual(["myday", "pipeline", "team"]);
    expect(keys("ADMIN", "full")).toEqual(["myday", "pipeline", "team"]);
    expect(keys("TEAM_MANAGER", "full")).toContain("team");
  });
  it("Today home follows its modules: RMs get My day, managers and admins get Team", () => {
    expect(keys("RM", "today")).toEqual(["myday", "pipeline"]);
    expect(keys("MANAGER", "today")).toEqual(["team", "pipeline"]);
    expect(keys("ADMIN", "today")).toEqual(["team", "pipeline"]);
  });
  it("never lists a tab without a label, and keys are unique", () => {
    for (const role of ["ADMIN", "MANAGER", "RM", "TEAM_MANAGER", "DEALER", "FINANCE"] as const) {
      for (const view of ["today", "full"] as const) {
        const tabs = homeTabsFor(role, view);
        expect(new Set(tabs.map((t) => t.key)).size).toBe(tabs.length);
        for (const t of tabs) expect(t.label).toBe(HOME_TABS[t.key]);
      }
    }
  });
});
