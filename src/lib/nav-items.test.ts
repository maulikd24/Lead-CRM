import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navItemEnabled, primaryNavFor, visibleNavItems } from "./nav-items";

const ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;

describe("primaryNavFor", () => {
  it.each(ROLES)("gives %s between 1 and 6 items they are allowed to open", (role) => {
    const items = primaryNavFor(role);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.length).toBeLessThanOrEqual(6);
    for (const item of items) {
      expect(NAV_ITEMS.some((n) => n.href === item.href)).toBe(true);
      expect(item.roles).toContain(role);
    }
  });
  it("starts every desk role with the dashboard", () => {
    for (const role of ["ADMIN", "MANAGER", "RM"] as const) expect(primaryNavFor(role)[0].href).toBe("/dashboard");
  });
  it("shows RMs the Agent drafts page so drafts are not left to expire unseen", () => {
    expect(primaryNavFor("RM").map((n) => n.href)).toEqual(["/dashboard", "/clients", "/inbox", "/tasks", "/copilot", "/agents"]);
    expect(primaryNavFor("MANAGER").map((n) => n.href)).not.toContain("/agents");
    expect(primaryNavFor("ADMIN").map((n) => n.href)).not.toContain("/agents");
  });
});

describe("call recordings nav item", () => {
  const item = NAV_ITEMS.find((n) => n.href === "/calls");
  it("is for admins and managers only, behind its flag, and never a primary nav item", () => {
    expect(item).toMatchObject({ roles: ["ADMIN", "MANAGER"], flag: "calls-review", category: "insights" });
    for (const role of ROLES) expect(primaryNavFor(role).map((n) => n.href)).not.toContain("/calls");
  });
  it("is hidden while the flag is off and shown to admins and managers, but not RMs, once it is on", () => {
    expect(visibleNavItems("ADMIN", []).map((n) => n.href)).not.toContain("/calls");
    expect(visibleNavItems("ADMIN", ["calls-review"]).map((n) => n.href)).toContain("/calls");
    expect(visibleNavItems("MANAGER", ["calls-review"]).map((n) => n.href)).toContain("/calls");
    expect(visibleNavItems("RM", ["calls-review"]).map((n) => n.href)).not.toContain("/calls");
  });
});

describe("duplicate review nav item", () => {
  it("is hidden unless its flag is on, and then open to Admin, Manager and RM (an RM only ever sees their own customers there)", () => {
    const item = NAV_ITEMS.find((i) => i.href === "/clients/duplicates");
    expect(item).toMatchObject({ roles: ["ADMIN", "MANAGER", "RM"], flag: "merge-review", category: "work" });
    expect(visibleNavItems("ADMIN", []).some((i) => i.href === "/clients/duplicates")).toBe(false);
    expect(visibleNavItems("ADMIN", ["merge-review"]).some((i) => i.href === "/clients/duplicates")).toBe(true);
    expect(visibleNavItems("RM", ["merge-review"]).some((i) => i.href === "/clients/duplicates")).toBe(true);
    expect(visibleNavItems("RM", []).some((i) => i.href === "/clients/duplicates")).toBe(false);
    expect(visibleNavItems("DEALER", ["merge-review"]).some((i) => i.href === "/clients/duplicates")).toBe(false);
  });
});

describe("visibleNavItems", () => {
  it("is exactly the role filter of every item (flag-off identity)", () => {
    for (const role of ROLES) {
      const expected = NAV_ITEMS.filter((n) => n.roles.includes(role) && !n.flag).map((n) => n.href);
      expect(visibleNavItems(role, []).map((n) => n.href)).toEqual(expected);
    }
  });
  it("returns the same array contents for the same inputs", () => {
    expect(visibleNavItems("ADMIN", [])).toEqual(visibleNavItems("ADMIN", []));
  });
  it("an item without a flag is always enabled", () => {
    const plain = NAV_ITEMS.find((n) => n.href === "/clients")!;
    expect(navItemEnabled(plain, [])).toBe(true);
  });
});
