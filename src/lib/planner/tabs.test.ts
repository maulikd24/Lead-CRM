import { describe, expect, it } from "vitest";

import { parsePlanTab, parseTab, plannerHref } from "./tabs";

describe("planner tabs", () => {
  it("falls back to the board for anything unknown, so a hand-edited URL never breaks the page", () => {
    expect(parseTab(undefined)).toBe("board");
    expect(parseTab("nope")).toBe("board");
    expect(parseTab(["routing", "x"])).toBe("routing");
    expect(parsePlanTab("history")).toBe("history");
    expect(parsePlanTab("zzz")).toBe("overview");
  });
  it("builds clean links", () => {
    expect(plannerHref("board")).toBe("/planner");
    expect(plannerHref("promises", { edit: "p1" })).toBe("/planner?tab=promises&edit=p1");
    expect(plannerHref("calendar", { month: undefined })).toBe("/planner?tab=calendar");
  });
});
