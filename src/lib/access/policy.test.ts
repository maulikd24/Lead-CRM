import { describe, expect, it } from "vitest";

import { Role } from "@/generated/prisma/client";

import { ACTIONS, ALL_ROLES, AREAS, AREA_KEYS, areaGroup, can, isArea, rolesWith, type Area } from "./policy";
import { canAccessMarketing } from "./marketing-access";

const roleList = ALL_ROLES as readonly string[];

describe("the registry knows every role", () => {
  it("lists exactly the roles of the database enum, so a new role cannot be forgotten", () => {
    expect([...roleList].sort()).toEqual(Object.values(Role).sort());
  });
});

describe("default deny", () => {
  it("refuses an unknown area, an unknown action, no role and an unknown role, even for ADMIN", () => {
    expect(can("ADMIN", "no-such-area")).toBe(false);
    expect(can("ADMIN", "clients", "teleport" as never)).toBe(false);
    expect(can(null, "clients")).toBe(false);
    expect(can(undefined, "clients")).toBe(false);
    expect(can("SUPERHERO", "clients")).toBe(false);
  });
  it("does not let a prototype key through as an area", () => {
    expect(can("ADMIN", "constructor")).toBe(false);
    expect(can("ADMIN", "__proto__")).toBe(false);
  });
  it("the Flags tab is ADMIN only and read only: no other role views it, and nobody manages or exports it", () => {
    expect(rolesWith("settings-flags")).toEqual(["ADMIN"]);
    for (const role of ALL_ROLES.filter((r) => r !== "ADMIN")) for (const action of ["view", "manage", "export"] as const) expect(can(role, "settings-flags", action), `${role} ${action}`).toBe(false);
    // ADMIN holds every action on a declared area, so the guarantee that nothing can change a flag from this tab is its absence of an action file
    expect(can("ADMIN", "settings-flags", "view")).toBe(true);
    expect(can(undefined, "settings-flags")).toBe(false);
    expect(isArea("settings-flags")).toBe(true);
  });

  it("refuses an action an area does not offer to a non-admin", () => {
    expect(can("RM", "reports", "view")).toBe(false);
    expect(can("MANAGER", "client-360", "export")).toBe(false);
  });
});

describe("ADMIN is a superuser", () => {
  it.each(AREA_KEYS)("holds every action on %s", (area) => {
    for (const action of ACTIONS) expect(can("ADMIN", area, action)).toBe(true);
  });
});

describe("segregation: marketing and customer work do not overlap", () => {
  const marketing = AREA_KEYS.filter((a) => areaGroup(a) === "marketing" && a !== "referral-program");
  const customerWork = AREA_KEYS.filter((a) => areaGroup(a) === "customer");

  it("gives MARKETING no customer area at all", () => {
    for (const area of customerWork) for (const action of ACTIONS) expect(can("MARKETING", area, action), `${area}.${action}`).toBe(false);
  });
  it("gives MARKETING none of: clients, inbox, calls, partners and payouts, data privacy, users and settings", () => {
    const forbidden: Area[] = ["clients", "client-360", "client-support", "client-consent", "inbox", "calls", "support", "partner-workspace", "partner-home", "partner-directory", "earnings", "referral-statements", "partner-finance", "erasure-requests", "settings-users", "settings-access", "settings-integrations", "settings-data-privacy", "settings-system", "intelligence", "copilot", "reports", "dashboard"];
    for (const area of forbidden) for (const action of ACTIONS) expect(can("MARKETING", area, action), `${area}.${action}`).toBe(false);
  });
  it.each(["MANAGER", "TEAM_MANAGER", "RM", "FINANCE", "DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"] as const)("gives %s no marketing area (RMs never see spend, budgets, creative, social, competitor ads, Autopilot)", (role) => {
    for (const area of marketing) for (const action of ACTIONS) expect(can(role, area, action), `${area}.${action}`).toBe(false);
  });
  it("lets only ADMIN and MARKETING into the Marketing workspace", () => {
    for (const role of roleList) expect(can(role, "marketing"), role).toBe(role === "ADMIN" || role === "MARKETING");
  });
  it("shares exactly one thing between marketing and desk roles: their own tasks, and the campaign label (FINANCE and MARKETING share the referral programme view)", () => {
    expect(rolesWith("tasks")).toEqual(["ADMIN", "MANAGER", "RM", "MARKETING"]);
    expect(rolesWith("lead-campaign-label")).toEqual(["ADMIN", "MANAGER", "TEAM_MANAGER", "RM"]);
    expect(rolesWith("referral-program")).toEqual(["ADMIN", "FINANCE", "MARKETING"]);
    expect(rolesWith("referral-program", "manage")).toEqual(["ADMIN", "MARKETING"]);
  });
});

describe("the other roles keep what they had", () => {
  it("RM: customers, leads, inbox, tasks, calls, Customer 360, outcomes, duplicates, own support", () => {
    for (const area of ["clients", "client-360", "inbox", "tasks", "calls", "outcomes", "duplicates", "client-support", "dashboard", "lead-campaign-label"] as const) expect(can("RM", area), area).toBe(true);
  });
  it("RM does not get manager or admin pages", () => {
    for (const area of ["reports", "management-dashboard", "intelligence", "households", "settings-users", "activity-log"] as const) expect(can("RM", area), area).toBe(false);
  });
  it("MANAGER keeps the team's customer work and reports, with no marketing module", () => {
    for (const area of ["clients", "reports", "management-dashboard", "intelligence", "households", "activity-log", "lead-campaign-label"] as const) expect(can("MANAGER", area), area).toBe(true);
    expect(can("MANAGER", "marketing")).toBe(false);
  });
  it("FINANCE keeps earnings, finance console and statements, and the referral programme view; no marketing", () => {
    for (const area of ["finance-console", "earnings", "referral-statements", "partner-finance", "partner-workspace", "referral-program"] as const) expect(can("FINANCE", area), area).toBe(true);
    expect(can("FINANCE", "marketing")).toBe(false);
    expect(can("FINANCE", "referral-program", "manage")).toBe(false);
  });
  it("partner roles reach only their own workspace", () => {
    for (const role of ["PARTNER", "AFFILIATE", "DISTRIBUTOR"] as const) {
      expect(can(role, "partner-home")).toBe(true);
      expect(can(role, "clients")).toBe(false);
      expect(can(role, "earnings")).toBe(false);
    }
  });
  it("DEALER keeps the dealer desk and nothing else", () => {
    expect(rolesWith("dealer-desk")).toEqual(["ADMIN", "DEALER"]);
    expect(can("DEALER", "clients")).toBe(false);
  });
});

describe("canAccessMarketing (the one helper every marketing screen uses)", () => {
  it("is true only for ADMIN and MARKETING", () => {
    for (const role of roleList) expect(canAccessMarketing(role as Role), role).toBe(role === "ADMIN" || role === "MARKETING");
    expect(canAccessMarketing(null)).toBe(false);
    expect(canAccessMarketing(undefined)).toBe(false);
  });
  it("agrees with the registry on every marketing area", () => {
    for (const area of AREA_KEYS.filter((a) => areaGroup(a) === "marketing" && a !== "referral-program")) {
      for (const role of roleList) expect(can(role, area), `${role} ${area}`).toBe(canAccessMarketing(role as Role));
    }
  });
});

describe("the table itself", () => {
  it("never lists ADMIN (it is implicit) and only lists real roles", () => {
    for (const area of AREA_KEYS) {
      for (const action of ACTIONS) {
        const granted = ((AREAS[area] as unknown) as Record<string, readonly string[] | undefined>)[action] ?? [];
        expect(granted, `${area}.${action}`).not.toContain("ADMIN");
        for (const role of granted) expect(roleList, `${area}.${action}`).toContain(role);
      }
    }
  });
});

describe("Wave 2 C: product registry, attention feed", () => {
  it("managing the registry is ADMIN only; nobody else can even view the management area", () => {
    expect(rolesWith("settings-product-registry")).toEqual(["ADMIN"]);
    expect(rolesWith("settings-product-registry", "manage")).toEqual(["ADMIN"]);
  });
  it("the read-only registry is for the desk (RM, manager), never for marketing, and nobody but ADMIN can change it through it", () => {
    expect(rolesWith("product-registry")).toEqual(["ADMIN", "MANAGER", "RM"]);
    expect(rolesWith("product-registry", "manage")).toEqual(["ADMIN"]);
    expect(can("MARKETING", "product-registry")).toBe(false);
  });
  it("MARKETING sees approved marketing claims and nothing else of the registry; no desk role sees the claims area", () => {
    expect(rolesWith("product-registry-claims")).toEqual(["ADMIN", "MARKETING"]);
    for (const role of ["MANAGER", "RM", "FINANCE", "DEALER", "PARTNER"] as const) expect(can(role, "product-registry-claims"), role).toBe(false);
  });
  it("the Needs attention feed: the desk sees its own scope, MARKETING only the campaign anomaly view, nobody crosses over", () => {
    expect(rolesWith("attention")).toEqual(["ADMIN", "MANAGER", "RM"]);
    expect(rolesWith("attention", "manage")).toEqual(["ADMIN", "MANAGER", "RM"]);
    expect(rolesWith("attention-marketing")).toEqual(["ADMIN", "MARKETING"]);
    expect(can("MARKETING", "attention")).toBe(false);
    expect(can("RM", "attention-marketing")).toBe(false);
    expect(can("MANAGER", "attention-marketing")).toBe(false);
  });
});
