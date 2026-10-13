import { describe, expect, it } from "vitest";

import type { Role } from "@/generated/prisma/client";
import { NAV_FLAGS } from "@/lib/nav-flags";
import { NAV_ITEMS, visibleNavItems } from "@/lib/nav-items";
import { NAV_DESCRIPTIONS } from "@/lib/nav-descriptions";
import { TRY_THIS } from "./try-this";
import { isStepOpen, shouldAutoStart, tourStepsFor } from "./steps";

const ROLES: Role[] = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE", "MARKETING"];
const ALL_FLAGS = Object.keys(NAV_FLAGS);

const hrefsOf = (role: Role, flags: readonly string[]) => tourStepsFor(role, flags).map((s) => s.href);

describe("tour steps match the screens each role can open", () => {
  for (const role of ROLES) {
    it(`${role}: all flags on, one step per openable screen`, () => {
      const openable = [...new Set(visibleNavItems(role, ALL_FLAGS).map((i) => i.href))].sort();
      expect([...new Set(hrefsOf(role, ALL_FLAGS))].sort()).toEqual(openable);
    });
    it(`${role}: all flags off, only the screens that need no flag`, () => {
      const openable = [...new Set(visibleNavItems(role, []).map((i) => i.href))].sort();
      expect([...new Set(hrefsOf(role, []))].sort()).toEqual(openable);
    });
  }

  it("never repeats a screen", () => {
    for (const role of ROLES) {
      const hrefs = hrefsOf(role, ALL_FLAGS);
      expect(new Set(hrefs).size, role).toBe(hrefs.length);
    }
  });

  it("RM gets no steps for admin, manager or finance screens", () => {
    const hrefs = new Set(hrefsOf("RM", ALL_FLAGS));
    for (const blocked of ["/settings/users", "/settings/access", "/activity-log", "/debugger", "/reports", "/earnings", "/settings/control-plane"]) {
      expect(hrefs.has(blocked), blocked).toBe(false);
    }
    expect(hrefs.has("/clients")).toBe(true);
  });

  it("an admin-only screen is not in any other role's tour", () => {
    for (const role of ROLES.filter((r) => r !== "ADMIN")) {
      expect(hrefsOf(role, ALL_FLAGS).includes("/settings/users"), role).toBe(false);
    }
  });

  it("a switched-off module gets no step, even for ADMIN", () => {
    expect(hrefsOf("ADMIN", []).includes("/settings/control-plane")).toBe(false);
    expect(hrefsOf("ADMIN", ["control-plane"]).includes("/settings/control-plane")).toBe(true);
  });

  it("every step opens a real nav item, with its own name", () => {
    const items = new Map(NAV_ITEMS.map((i) => [i.href, i.label]));
    for (const step of tourStepsFor("ADMIN", ALL_FLAGS)) {
      expect(items.get(step.href), step.href).toBe(step.title);
    }
  });
});

describe("each step explains the screen and says what to try", () => {
  it("every step has a plain-language purpose and a try line, never the fallback text", () => {
    for (const role of ROLES) {
      for (const step of tourStepsFor(role, ALL_FLAGS)) {
        expect(NAV_DESCRIPTIONS[step.href], `${role} ${step.href} purpose`).toBeTruthy();
        expect(TRY_THIS[step.href], `${role} ${step.href} try`).toBeTruthy();
        expect(step.purpose).not.toBe("Open this screen to see what it shows.");
        expect(step.tryThis).not.toBe("Open this screen and look around.");
      }
    }
  });

  it("every nav item in the product has a purpose and a try line", () => {
    for (const item of NAV_ITEMS) {
      expect(NAV_DESCRIPTIONS[item.href], item.href).toBeTruthy();
      expect(TRY_THIS[item.href], item.href).toBeTruthy();
    }
  });

  it("the Clients step tells the person to look at the timeline", () => {
    const clients = tourStepsFor("RM", ALL_FLAGS).find((s) => s.href === "/clients");
    expect(clients?.tryThis).toMatch(/timeline/i);
  });
});

describe("when the tour starts", () => {
  it("starts for a person who has not seen it", () => {
    expect(shouldAutoStart(false, 5)).toBe(true);
  });
  it("does not start once hasSeenTour is set", () => {
    expect(shouldAutoStart(true, 5)).toBe(false);
  });
  it("does not start for a role with no screens to show", () => {
    expect(shouldAutoStart(false, 0)).toBe(false);
  });
});

describe("isStepOpen", () => {
  it("matches the path and the query parameters the step names", () => {
    expect(isStepOpen("/dashboard?tab=attention", "/dashboard", "tab=attention")).toBe(true);
    expect(isStepOpen("/dashboard?tab=attention", "/dashboard", "")).toBe(false);
    expect(isStepOpen("/clients", "/clients", "x=1")).toBe(true);
    expect(isStepOpen("/clients", "/leads", "")).toBe(false);
  });
});
