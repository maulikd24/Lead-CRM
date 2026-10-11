import { describe, expect, it } from "vitest";

import { ALL_ROLES } from "@/lib/access/policy";
import { actionTiles } from "./action-tiles";

const counts = { approvals: 3, overdue: 5, dueToday: 2, openComplaints: 1, latePromises: 4 };
const labels = (role: (typeof ALL_ROLES)[number], flags: string[] = ["approvals-inbox", "service-state"]) => actionTiles(role, flags, counts).map((t) => t.label);

describe("Today's action strip: what needs you, not vanity numbers", () => {
  it("leads with approvals, then overdue work, then commitments and complaints, for a desk role with every flag on", () => {
    expect(labels("RM")).toEqual(["Approvals waiting", "Overdue tasks", "Late promises", "Open complaints", "Due today"]);
  });
  it("hides a tile whose module is off, and approvals for a role without the inbox", () => {
    expect(labels("RM", [])).toEqual(["Overdue tasks", "Due today"]);
    expect(labels("DEALER")).toEqual([]);
    expect(labels("PARTNER")).toEqual([]);
  });
  it("marketing sees approvals and its own tasks, never complaints or promises (customer data)", () => {
    expect(labels("MARKETING")).toEqual(["Approvals waiting", "Overdue tasks", "Due today"]);
  });
  it("links every tile to the screen that acts on it and colours only what is waiting", () => {
    const t = actionTiles("MANAGER", ["approvals-inbox", "service-state"], counts);
    expect(t.map((x) => x.href)).toEqual(["/approvals", "/tasks", "/service", "/service", "/tasks"]);
    expect(t.find((x) => x.label === "Overdue tasks")?.tone).toBe("destructive");
    expect(actionTiles("MANAGER", ["approvals-inbox"], { ...counts, approvals: 0, overdue: 0 }).every((x) => x.tone === "default")).toBe(true);
  });
  it("never offers a tile to a role the registry refuses it", () => {
    for (const role of ALL_ROLES) for (const t of actionTiles(role, ["approvals-inbox", "service-state"], counts)) expect(["/approvals", "/tasks", "/service"]).toContain(t.href);
    expect(labels("FINANCE")).toEqual(["Approvals waiting"]);
  });
});
