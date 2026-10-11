import { describe, expect, it } from "vitest";

import { NAV_FLAGS } from "@/lib/nav-flags";
import { can } from "@/lib/access/policy";
import { NAV_ITEMS } from "@/lib/nav-items";
import legacy from "./legacy-nav.json";
import { activeNavEntry, allModules, navEntriesFor, panelFor, railFor, type SpaceKey } from "./model";

const ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE", "MARKETING"] as const;
const ALL_FLAGS = Object.keys(NAV_FLAGS);
const spaces = (role: (typeof ROLES)[number], flags: string[] = ALL_FLAGS) => railFor(navEntriesFor(role, flags)).map((r) => r.space);

describe("the rail per role: intentionally small, and only what the role may open", () => {
  it("RM: Today, Customers, Service, Insights (own)", () => expect(spaces("RM")).toEqual(["today", "customers", "service", "insights"]));
  it("MARKETING: Today, Growth, Insights", () => expect(spaces("MARKETING")).toEqual(["today", "growth", "insights"]));
  it("MANAGER: Today, Customers, Service, Insights and no Growth (they have no marketing)", () => expect(spaces("MANAGER")).toEqual(["today", "customers", "service", "insights"]));
  it("FINANCE sees Today and Partners only", () => expect(spaces("FINANCE")).toEqual(["today", "partners"]));
  it("PARTNER, AFFILIATE and DISTRIBUTOR see Today and Partners only", () => {
    for (const r of ["PARTNER", "AFFILIATE", "DISTRIBUTOR"] as const) expect(spaces(r), r).toEqual(["today", "partners"]);
  });
  it("TEAM_MANAGER sees Today and Partners, DEALER only Today", () => {
    expect(spaces("TEAM_MANAGER")).toEqual(["today", "partners"]);
    expect(spaces("DEALER")).toEqual(["today"]);
  });
  it("ADMIN sees every workspace", () => expect(spaces("ADMIN")).toEqual(["today", "customers", "growth", "service", "partners", "insights", "admin"]));
  it("only ADMIN ever sees the Admin (control plane) workspace, and only ADMIN and MARKETING see Growth", () => {
    for (const r of ROLES) {
      expect(spaces(r).includes("admin"), r).toBe(r === "ADMIN");
      expect(spaces(r).includes("growth"), r).toBe(r === "ADMIN" || r === "MARKETING");
    }
  });
});

describe("every entry is policy-checked: a role never gets an item the registry refuses", () => {
  it("no entry for a role whose area view is refused, with every flag on or off", () => {
    for (const flags of [ALL_FLAGS, []]) {
      for (const role of ROLES) {
        for (const e of navEntriesFor(role, flags)) expect(can(role, e.area, "view"), `${role} ${e.href}`).toBe(true);
      }
    }
  });
  it("hrefs are unique and every item names its workspace and group", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const i of NAV_ITEMS) {
      expect(i.space, i.href).toBeTruthy();
      expect(i.group, i.href).toBeTruthy();
    }
  });
});

describe("flags and setup: greyed with its state for ADMIN, hidden for everyone else", () => {
  it("a flag that is off shows the item greyed (Off) to ADMIN and not at all to other roles", () => {
    const admin = navEntriesFor("ADMIN", []).find((e) => e.href === "/leads");
    expect(admin).toMatchObject({ state: "off" });
    expect(admin?.stateNote).toMatch(/off/i);
    for (const r of ROLES.filter((x) => x !== "ADMIN")) expect(navEntriesFor(r, []).some((e) => e.state !== "active"), r).toBe(false);
    expect(navEntriesFor("RM", []).some((e) => e.href === "/leads")).toBe(false);
  });
  it("a flag that is on but needs setup shows as Needs setup to ADMIN only", () => {
    const e = navEntriesFor("ADMIN", ALL_FLAGS, { setupNeeded: ["referral-program"] }).find((x) => x.href === "/referrals");
    expect(e).toMatchObject({ state: "setup" });
    const m = navEntriesFor("MARKETING", ALL_FLAGS, { setupNeeded: ["referral-program"] }).find((x) => x.href === "/referrals");
    expect(m?.state).toBe("active");
  });
  it("an item the role may not open is hidden even from the greyed list (no state is shown for what a role cannot reach)", () => {
    expect(navEntriesFor("RM", []).some((e) => e.href === "/marketing")).toBe(false);
    expect(navEntriesFor("ADMIN", []).find((e) => e.href === "/marketing")?.state).toBe("off");
  });
});

describe("parity: every page that was in the old nav is still reachable by the role that could reach it", () => {
  it("each legacy href is in the new nav entries (panel or All modules) for that role, flags on", () => {
    for (const role of ROLES) {
      const now = new Set(navEntriesFor(role, ALL_FLAGS).map((e) => e.href));
      for (const href of (legacy as Record<string, string[]>)[role]) expect(now.has(href), `${role} lost ${href}`).toBe(true);
    }
  });
  it("the All modules directory lists every entry once, none missing", () => {
    for (const role of ROLES) {
      const entries = navEntriesFor(role, ALL_FLAGS);
      const listed = allModules(entries).flatMap((s) => s.groups.flatMap((g) => g.entries.map((e) => e.href)));
      expect(new Set(listed), role).toEqual(new Set(entries.map((e) => e.href)));
    }
  });
});

describe("panel: grouped, ordered, and the workspace's own", () => {
  it("Growth for marketing is grouped Plan, Run, Grow, Measure, Connect", () => {
    const groups = panelFor(navEntriesFor("MARKETING", ALL_FLAGS), "growth").map((g) => g.group);
    expect(groups).toEqual(["Plan", "Run", "Grow", "Measure", "Connect"]);
  });
  it("every entry of a panel belongs to that workspace for this role", () => {
    for (const role of ROLES) {
      const entries = navEntriesFor(role, ALL_FLAGS);
      for (const space of railFor(entries).map((r) => r.space as SpaceKey)) {
        for (const g of panelFor(entries, space)) for (const e of g.entries) expect(e.space === space || e.alsoIn?.includes(space), `${role} ${e.href}`).toBe(true);
      }
    }
  });
  it("Approvals is reachable from Today and, for ADMIN, also listed under the control plane", () => {
    const e = navEntriesFor("ADMIN", ALL_FLAGS);
    expect(panelFor(e, "today").flatMap((g) => g.entries).some((x) => x.href === "/approvals")).toBe(true);
    expect(panelFor(e, "admin").flatMap((g) => g.entries).some((x) => x.href === "/approvals")).toBe(true);
  });
});

describe("the active item", () => {
  const hrefs = ["/dashboard", "/dashboard?tab=attention", "/clients", "/clients/duplicates", "/marketing", "/marketing?tab=campaigns"];
  it("matches the longest path and the query it names", () => {
    expect(activeNavEntry("/dashboard", "", hrefs)).toBe("/dashboard");
    expect(activeNavEntry("/dashboard", "tab=attention", hrefs)).toBe("/dashboard?tab=attention");
    expect(activeNavEntry("/clients/duplicates", "", hrefs)).toBe("/clients/duplicates");
    expect(activeNavEntry("/clients/abc", "", hrefs)).toBe("/clients");
    expect(activeNavEntry("/marketing", "tab=campaigns&range=30d", hrefs)).toBe("/marketing?tab=campaigns");
    expect(activeNavEntry("/elsewhere", "", hrefs)).toBeNull();
  });
});
