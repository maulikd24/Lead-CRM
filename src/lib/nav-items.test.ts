import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navItemEnabled, primaryNavFor } from "./nav-items";

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

describe("partner workspace nav item", () => {
  const item = NAV_ITEMS.find((n) => n.href === "/partners");
  it("exists for ADMIN, FINANCE and TEAM_MANAGER only, behind its flag", () => {
    expect(item).toBeDefined();
    expect([...(item?.roles ?? [])].sort()).toEqual(["ADMIN", "FINANCE", "TEAM_MANAGER"]);
    expect(item?.flag).toBe("partner-workspace");
  });
  it("is not part of any role's primary nav", () => {
    for (const role of ROLES) expect(primaryNavFor(role).map((n) => n.href)).not.toContain("/partners");
  });
  it("is hidden unless its flag is enabled", () => {
    expect(item && navItemEnabled(item, [])).toBe(false);
    expect(item && navItemEnabled(item, ["partner-workspace"])).toBe(true);
    const plain = NAV_ITEMS.find((n) => n.href === "/clients")!;
    expect(navItemEnabled(plain, [])).toBe(true);
  });
});
