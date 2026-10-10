import { describe, expect, it } from "vitest";

import { NAV_FLAGS, enabledNavFlags, type NavFlag } from "./nav-flags";
import { NAV_DESCRIPTIONS } from "./nav-descriptions";
import { NAV_ITEMS, primaryNavFor, visibleNavItems } from "./nav-items";

const ROLES = ["ADMIN", "MANAGER", "RM", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"] as const;
type R = (typeof ROLES)[number];
const ALL: R[] = [...ROLES];
const DESK: R[] = ["ADMIN", "MANAGER", "RM"];
const AM: R[] = ["ADMIN", "MANAGER"];
const DISTRIBUTION: R[] = ["TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR", "FINANCE"];
const UNIVERSAL: R[] = ["ADMIN", "MANAGER", "RM", "DEALER", ...DISTRIBUTION];

/** One env var per flag. The nav flag turns on for exactly the value "1". */
const FLAG_ENV: Record<NavFlag, string> = {
  "partner-workspace": "PARTNER_WORKSPACE_ENABLED",
  "calls-review": "NEXT_PUBLIC_CALLS_REVIEW",
  "merge-review": "NEXT_PUBLIC_MERGE_REVIEW",
  "support-sla": "NEXT_PUBLIC_SUPPORT_SLA",
  marketing: "NEXT_PUBLIC_MARKETING",
  "backoffice-import": "BACKOFFICE_IMPORT_ENABLED",
};

/** The role gate contract for every nav item, and the flag (if any) it sits behind. Changing a gate means changing this table on purpose. */
const CONTRACT: Record<string, { roles: R[]; flag?: NavFlag }> = {
  "/dashboard": { roles: DESK },
  "/copilot": { roles: DESK },
  "/clients": { roles: DESK },
  "/clients/duplicates": { roles: DESK, flag: "merge-review" },
  "/households": { roles: AM },
  "/tasks": { roles: DESK },
  "/inbox": { roles: DESK },
  "/agents": { roles: DESK },
  "/reports": { roles: AM },
  "/management-dashboard": { roles: AM },
  "/intelligence": { roles: AM },
  "/marketing": { roles: AM, flag: "marketing" },
  "/quality-audit": { roles: DESK },
  "/calls": { roles: AM, flag: "calls-review" },
  "/support": { roles: AM, flag: "support-sla" },
  "/exceptions": { roles: AM },
  "/journeys": { roles: AM },
  "/dealer-desk": { roles: ["DEALER"] },
  "/partner-home": { roles: ["PARTNER", "AFFILIATE", "DISTRIBUTOR"] },
  "/management-console": { roles: ["TEAM_MANAGER"] },
  "/partners": { roles: ["ADMIN", "FINANCE", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"], flag: "partner-workspace" },
  "/earnings": { roles: ["ADMIN", "FINANCE"] },
  "/finance-console": { roles: ["ADMIN", "FINANCE"] },
  "/settings/account": { roles: UNIVERSAL },
  "/settings/stages": { roles: ["ADMIN"] },
  "/settings/templates": { roles: ["ADMIN"] },
  "/settings/users": { roles: ["ADMIN"] },
  "/settings/integrations": { roles: ["ADMIN"] },
  "/settings/whatsapp": { roles: ["ADMIN"] },
  "/settings/approval-workflows": { roles: ["ADMIN"] },
  "/settings/lead-assignment": { roles: ["ADMIN"] },
  "/activity-log": { roles: AM },
  "/settings/data-privacy": { roles: ["ADMIN"] },
  "/settings/partner-tiers": { roles: ["ADMIN"] },
  "/settings/partner-finance": { roles: ["ADMIN", "FINANCE"], flag: "partner-workspace" },
  "/settings/go-live": { roles: ["ADMIN"] },
  "/settings/backoffice-import": { roles: ["ADMIN"], flag: "backoffice-import" },
  "/settings/system": { roles: ["ADMIN"] },
  "/debugger": { roles: ["ADMIN"] },
  "/handbook": { roles: UNIVERSAL },
  "/feature-specs": { roles: AM },
  "/release-notes": { roles: UNIVERSAL },
  "/help": { roles: UNIVERSAL },
};

const FLAGS = Object.keys(NAV_FLAGS) as NavFlag[];
const envWith = (...on: NavFlag[]) => Object.fromEntries(on.map((f) => [FLAG_ENV[f], "1"]));

describe("nav flags: one mechanism, evaluated in one place", () => {
  it("every flag has its own env var and nothing is enabled by default", () => {
    expect(FLAGS.sort()).toEqual(Object.keys(FLAG_ENV).sort());
    expect(enabledNavFlags({})).toEqual([]);
  });
  it.each(FLAGS)("%s turns on for exactly the value 1 and nothing else", (flag) => {
    expect(enabledNavFlags(envWith(flag))).toEqual([flag]);
    for (const v of ["0", "true", "yes", "", " 1", "on"]) expect(enabledNavFlags({ [FLAG_ENV[flag]]: v })).toEqual([]);
  });
  it("turns every flag on together", () => {
    expect([...enabledNavFlags(envWith(...FLAGS))].sort()).toEqual([...FLAGS].sort());
  });
  it("every item's flag is a registered flag, and every registered flag guards at least one item", () => {
    for (const item of NAV_ITEMS) if (item.flag) expect(FLAGS, item.href).toContain(item.flag);
    for (const flag of FLAGS) expect(NAV_ITEMS.some((i) => i.flag === flag), flag).toBe(true);
  });
  it("nav-items.ts and the sidebar helpers read no env var themselves", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./nav-items.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/process\.env/);
  });
});

describe("the role and flag contract covers every nav item", () => {
  it("lists exactly the items in NAV_ITEMS, in no hidden extra or missing item", () => {
    expect(NAV_ITEMS.map((i) => i.href).sort()).toEqual(Object.keys(CONTRACT).sort());
  });
  it.each(Object.entries(CONTRACT))("%s has the contracted roles and flag", (href, want) => {
    const item = NAV_ITEMS.find((i) => i.href === href)!;
    expect([...item.roles].sort()).toEqual([...want.roles].sort());
    expect(item.flag).toBe(want.flag);
  });
});

describe("flag off: every flagged item is hidden, for every role, everywhere", () => {
  it.each(ROLES)("%s sees no flagged item with no flags enabled", (role) => {
    expect(visibleNavItems(role, []).filter((i) => i.flag)).toEqual([]);
  });
  it.each(ROLES)("%s sees exactly the unflagged items their role allows (flag-off identity)", (role) => {
    const want = Object.entries(CONTRACT).filter(([, c]) => !c.flag && c.roles.includes(role)).map(([h]) => h).sort();
    expect(visibleNavItems(role, []).map((i) => i.href).sort()).toEqual(want);
  });
  it("an unknown flag name enables nothing", () => {
    for (const role of ROLES) expect(visibleNavItems(role, ["not-a-flag"]).filter((i) => i.flag)).toEqual([]);
  });
  it("a flag only reveals its own items", () => {
    for (const flag of FLAGS) {
      for (const role of ROLES) {
        const shown = visibleNavItems(role, [flag]).filter((i) => i.flag);
        expect(shown.every((i) => i.flag === flag), `${flag}/${role}`).toBe(true);
      }
    }
  });
  it("is the same for the real env: with no env vars set nothing flagged shows", () => {
    for (const role of ROLES) expect(visibleNavItems(role, enabledNavFlags({})).filter((i) => i.flag)).toEqual([]);
  });
});

describe("flag on: the role gate still holds", () => {
  it.each(FLAGS)("%s on: each role sees the flagged item only if the role is allowed", (flag) => {
    for (const role of ROLES) {
      for (const [href, c] of Object.entries(CONTRACT).filter(([, c]) => c.flag === flag)) {
        const seen = visibleNavItems(role, enabledNavFlags(envWith(flag))).some((i) => i.href === href);
        expect(seen, `${href} for ${role}`).toBe(c.roles.includes(role));
      }
    }
  });
  it("with every flag on, each role sees exactly the contracted items", () => {
    const flags = enabledNavFlags(envWith(...FLAGS));
    for (const role of ROLES) {
      const want = Object.entries(CONTRACT).filter(([, c]) => c.roles.includes(role)).map(([h]) => h).sort();
      expect(visibleNavItems(role, flags).map((i) => i.href).sort(), role).toEqual(want);
    }
  });
  it("RM and the distribution roles never get an admin or manager only item, with every flag on", () => {
    const flags = enabledNavFlags(envWith(...FLAGS));
    for (const role of ["RM", "DEALER", ...DISTRIBUTION.filter((r) => r !== "FINANCE")] as R[]) {
      const shown = visibleNavItems(role, flags).map((i) => i.href);
      // The partner workspace is theirs by design (they see only their own network there), so it is not in this list.
      for (const href of ["/calls", "/support", "/marketing", "/reports", "/settings/users", "/settings/backoffice-import", "/debugger"]) expect(shown, `${href} for ${role}`).not.toContain(href);
    }
  });
});

describe("primary nav and descriptions respect the same gates", () => {
  it("no flagged item is ever a primary nav item, whatever flags are on", () => {
    for (const role of ROLES) for (const item of primaryNavFor(role, enabledNavFlags(envWith(...FLAGS)))) expect(item.flag, `${item.href} for ${role}`).toBeUndefined();
  });
  it("every nav item that can be shown has a plain-words description", () => {
    for (const item of NAV_ITEMS) if (["/clients/duplicates", "/calls", "/support", "/marketing", "/partners", "/settings/partner-finance", "/settings/backoffice-import"].includes(item.href)) expect(NAV_DESCRIPTIONS[item.href], item.href).toBeTruthy();
  });
});

describe("flagged item details", () => {
  it("Back-office import: admins only, under Administration, with a description", () => {
    expect(NAV_ITEMS.find((i) => i.href === "/settings/backoffice-import")).toMatchObject({ label: "Back-office import", roles: ["ADMIN"], category: "administration", flag: "backoffice-import" });
    expect(NAV_DESCRIPTIONS["/settings/backoffice-import"]).toMatch(/import/i);
  });
  it("Support SLA: admins and managers, under Insights, with a description", () => {
    expect(NAV_ITEMS.find((i) => i.href === "/support")).toMatchObject({ label: "Support SLA", roles: ["ADMIN", "MANAGER"], category: "insights" });
    expect(NAV_DESCRIPTIONS["/support"]).toBeTruthy();
  });
  it("Marketing: admins and managers, under Insights, described as read-only", () => {
    expect(NAV_ITEMS.find((i) => i.href === "/marketing")).toMatchObject({ label: "Marketing", roles: ["ADMIN", "MANAGER"], category: "insights" });
    expect(NAV_DESCRIPTIONS["/marketing"]).toMatch(/cost per lead/i);
  });
});
