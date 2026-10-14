import { describe, expect, it } from "vitest";

import { ALL_ROLES, can } from "@/lib/access/policy";
import { NAV_FLAGS } from "@/lib/nav-flags";
import { commandsFor, type PaletteCommand } from "./commands";

const FLAGS = Object.keys(NAV_FLAGS);
const ids = (role: (typeof ALL_ROLES)[number], flags = FLAGS) => commandsFor(role, flags).map((c) => c.id);

describe("palette commands are filtered by the same policy registry as the pages", () => {
  it("create task and log call only for roles that manage tasks/calls and may open customers", () => {
    for (const role of ALL_ROLES) {
      const expected = can(role, "tasks", "manage") && can(role, "clients", "view");
      expect(ids(role).includes("create-task"), role).toBe(expected);
      expect(ids(role).includes("log-call"), role).toBe(can(role, "calls", "manage") && can(role, "clients", "view"));
    }
  });
  it("marketing gets no customer command at all", () => {
    expect(ids("MARKETING").filter((i) => ["create-task", "log-call", "new-client"].includes(i))).toEqual([]);
  });
  it("new client needs manage on clients", () => {
    for (const role of ALL_ROLES) expect(ids(role).includes("new-client"), role).toBe(can(role, "clients", "manage"));
  });
  it("every navigate command is a page the role can open: area view is allowed", () => {
    for (const role of ALL_ROLES) {
      for (const c of commandsFor(role, FLAGS).filter((x: PaletteCommand) => x.effect.type === "go" && x.area)) expect(can(role, c.area!, "view"), `${role} ${c.id}`).toBe(true);
    }
  });
  it("open-workspace commands follow the rail: a role never gets a workspace it has no pages in", () => {
    expect(ids("RM").filter((i) => i.startsWith("open-")).sort()).toEqual(["open-customers", "open-insights", "open-service", "open-today"]);
    expect(ids("MARKETING").filter((i) => i.startsWith("open-")).sort()).toEqual(["open-growth", "open-today"]);
    expect(ids("FINANCE").filter((i) => i.startsWith("open-")).sort()).toEqual(["open-partners", "open-today"]);
    expect(ids("RM").includes("open-admin")).toBe(false);
    expect(ids("ADMIN").includes("open-admin")).toBe(true);
  });
  it("theme toggle is for everyone", () => {
    for (const role of ALL_ROLES) expect(ids(role)).toContain("toggle-theme");
  });
});
