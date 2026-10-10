import { describe, expect, it } from "vitest";

import { HOME_TABS, homeTabsFor, myDayTaskFilter } from "./tabs";

const keys = (role: Parameters<typeof homeTabsFor>[0], view: Parameters<typeof homeTabsFor>[1]) => homeTabsFor(role, view).map((t) => t.key);

describe("homeTabsFor", () => {
  it("full dashboard: My day and Pipeline for everyone, Team for everyone but RMs", () => {
    expect(keys("RM", "full")).toEqual(["myday", "pipeline"]);
    expect(keys("MANAGER", "full")).toEqual(["myday", "pipeline", "team"]);
    expect(keys("ADMIN", "full")).toEqual(["myday", "pipeline", "team"]);
    expect(keys("TEAM_MANAGER", "full")).toContain("team");
  });
  it("Today home: RMs get My day first; managers and admins lead with Team and also get their own My day", () => {
    expect(keys("RM", "today")).toEqual(["myday", "pipeline"]);
    expect(keys("MANAGER", "today")).toEqual(["team", "pipeline", "myday"]);
    expect(keys("ADMIN", "today")).toEqual(["team", "pipeline", "myday"]);
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

describe("myDayTaskFilter", () => {
  const team = { assignedToId: { in: ["m1", "rm-1", "rm-2"] } };
  it("an RM's filter is already their own, so it is kept as it is", () => {
    expect(myDayTaskFilter("RM", "rm-1", { assignedToId: { in: ["rm-1"] } })).toEqual({ assignedToId: { in: ["rm-1"] } });
  });
  it("a manager's My day is their own tasks, not the team's", () => {
    expect(myDayTaskFilter("MANAGER", "m1", team)).toEqual({ assignedToId: "m1" });
  });
  it("an admin's My day is their own tasks, not everyone's", () => {
    expect(myDayTaskFilter("ADMIN", "a1", {})).toEqual({ assignedToId: "a1" });
  });
});
