import { describe, expect, it } from "vitest";
import { NAV_ITEMS, navItemEnabled, visibleNavItems } from "./nav-items";

const ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE", "MARKETING"] as const;

describe("call recordings nav item", () => {
  const item = NAV_ITEMS.find((n) => n.href === "/calls");
  it("is for admins and managers only, behind its flag, in Team / Quality", () => {
    expect(item).toMatchObject({ roles: ["ADMIN", "MANAGER"], flag: "calls-review", space: "insights", group: "Quality" });
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
    expect(item).toMatchObject({ roles: ["ADMIN", "MANAGER", "RM"], flag: "merge-review", space: "customers" });
    expect(visibleNavItems("ADMIN", []).some((i) => i.href === "/clients/duplicates")).toBe(false);
    expect(visibleNavItems("ADMIN", ["merge-review"]).some((i) => i.href === "/clients/duplicates")).toBe(true);
    expect(visibleNavItems("RM", ["merge-review"]).some((i) => i.href === "/clients/duplicates")).toBe(true);
    expect(visibleNavItems("RM", []).some((i) => i.href === "/clients/duplicates")).toBe(false);
    expect(visibleNavItems("DEALER", ["merge-review"]).some((i) => i.href === "/clients/duplicates")).toBe(false);
  });
});

describe("partner workspace nav item", () => {
  const item = NAV_ITEMS.find((n) => n.href === "/partners");
  it("exists for admin, finance, the partner roles and team managers, behind its flag", () => {
    expect(item).toBeDefined();
    expect([...(item?.roles ?? [])].sort()).toEqual(["ADMIN", "AFFILIATE", "DISTRIBUTOR", "FINANCE", "PARTNER", "TEAM_MANAGER"]);
    expect(item?.flag).toBe("partner-workspace");
  });
  it("is hidden unless its flag is enabled", () => {
    expect(item && navItemEnabled(item, [])).toBe(false);
    expect(item && navItemEnabled(item, ["partner-workspace"])).toBe(true);
    const plain = NAV_ITEMS.find((n) => n.href === "/clients")!;
    expect(navItemEnabled(plain, [])).toBe(true);
  });
});

describe("visibleNavItems", () => {
  it("hides the flagged item unless its flag is on, for every role", () => {
    for (const role of ROLES) {
      expect(visibleNavItems(role, []).map((n) => n.href)).not.toContain("/partners");
      const on = visibleNavItems(role, ["partner-workspace"]).map((n) => n.href);
      expect(on.includes("/partners"), role).toBe(["ADMIN", "FINANCE", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "TEAM_MANAGER"].includes(role));
    }
  });
  it("with the flag off is exactly the role filter of every non-flagged item (flag-off identity)", () => {
    for (const role of ROLES) {
      const expected = NAV_ITEMS.filter((n) => n.roles.includes(role) && !n.flag).map((n) => n.href);
      expect(visibleNavItems(role, []).map((n) => n.href)).toEqual(expected);
    }
  });
  it("returns the same array contents for the same inputs", () => {
    expect(visibleNavItems("ADMIN", ["partner-workspace"])).toEqual(visibleNavItems("ADMIN", ["partner-workspace"]));
  });
});
