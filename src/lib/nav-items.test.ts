import { describe, expect, it, vi } from "vitest";
import { CALLS_REVIEW_NAV_ITEM, NAV_ITEMS, navItemEnabled, primaryNavFor, visibleNavItems } from "./nav-items";

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
  it("is for admins and managers only and never a primary nav item", () => {
    expect(CALLS_REVIEW_NAV_ITEM.href).toBe("/calls");
    expect(CALLS_REVIEW_NAV_ITEM.roles).toEqual(["ADMIN", "MANAGER"]);
    for (const role of ROLES) expect(primaryNavFor(role).map((n) => n.href)).not.toContain("/calls");
  });
  it("is absent from NAV_ITEMS while the flag is off", () => {
    expect(process.env.NEXT_PUBLIC_CALLS_REVIEW).not.toBe("1");
    expect(NAV_ITEMS.map((n) => n.href)).not.toContain("/calls");
  });
  it("appears for admins and managers, but not RMs, once the flag is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_CALLS_REVIEW", "1");
    vi.resetModules();
    const mod = await import("./nav-items");
    const item = mod.NAV_ITEMS.find((n) => n.href === "/calls");
    vi.unstubAllEnvs();
    expect(item?.roles).toEqual(["ADMIN", "MANAGER"]);
  });
});

describe("duplicate review nav item", () => {
  it("is hidden unless NEXT_PUBLIC_MERGE_REVIEW=1, and then limited to Admin and Manager", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "");
    expect((await import("./nav-items")).NAV_ITEMS.some((i) => i.href === "/clients/duplicates")).toBe(false);
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MERGE_REVIEW", "1");
    const on = (await import("./nav-items")).NAV_ITEMS.find((i) => i.href === "/clients/duplicates");
    expect(on?.roles).toEqual(["ADMIN", "MANAGER"]);
    vi.unstubAllEnvs();
  });
});

describe("partner workspace nav item", () => {
  const item = NAV_ITEMS.find((n) => n.href === "/partners");
  it("exists for ADMIN and FINANCE only, behind its flag", () => {
    expect(item).toBeDefined();
    expect([...(item?.roles ?? [])].sort()).toEqual(["ADMIN", "FINANCE"]);
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

describe("visibleNavItems", () => {
  it("hides the flagged item unless its flag is on, for every role", () => {
    for (const role of ROLES) {
      expect(visibleNavItems(role, []).map((n) => n.href)).not.toContain("/partners");
      const on = visibleNavItems(role, ["partner-workspace"]).map((n) => n.href);
      expect(on.includes("/partners")).toBe(role === "ADMIN" || role === "FINANCE");
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
