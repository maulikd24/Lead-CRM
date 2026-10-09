import { describe, expect, it, vi } from "vitest";
import { CALLS_REVIEW_NAV_ITEM, NAV_ITEMS, primaryNavFor } from "./nav-items";

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
