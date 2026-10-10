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

describe("Needs attention tab (flag NEXT_PUBLIC_OUTCOMES)", () => {
  const withAttention = (role: Parameters<typeof homeTabsFor>[0], view: Parameters<typeof homeTabsFor>[1]) => homeTabsFor(role, view, { attention: true }).map((t) => t.key);
  it("is absent unless asked for, so the default tab lists are unchanged", () => {
    expect(keys("RM", "today")).not.toContain("attention");
    expect(homeTabsFor("RM", "today", { attention: false }).map((t) => t.key)).toEqual(["myday", "pipeline"]);
  });
  it("is the second tab for the desk roles and never changes which tab opens first", () => {
    expect(withAttention("RM", "today")).toEqual(["myday", "attention", "pipeline"]);
    expect(withAttention("MANAGER", "today")).toEqual(["team", "attention", "pipeline", "myday"]);
    expect(withAttention("ADMIN", "full")).toEqual(["myday", "attention", "pipeline", "team"]);
    expect(withAttention("RM", "full")[0]).toBe("myday");
  });
  it("is not offered to roles without a customer desk", () => {
    for (const role of ["DEALER", "FINANCE", "PARTNER"] as const) expect(withAttention(role, "today")).not.toContain("attention");
  });
  it("is labelled in plain words", () => {
    expect(HOME_TABS.attention).toBe("Needs attention");
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
