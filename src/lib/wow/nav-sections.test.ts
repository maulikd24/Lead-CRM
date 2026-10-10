import { Gift } from "lucide-react";
import { describe, expect, it } from "vitest";

import type { NavItem } from "@/lib/nav-items";
import { badgeText, buildSections, initialOpen, railCookieName, roleLabel } from "./nav-sections";

const item = (href: string, category?: NavItem["category"]): NavItem => ({ href, label: href, icon: Gift, roles: ["ADMIN"], category });

describe("buildSections", () => {
  const items = [item("/dashboard"), item("/clients", "work"), item("/tasks", "work"), item("/reports", "insights"), item("/dealer-desk")];
  it("emits a section where its first item appears and keeps the order inside it", () => {
    const s = buildSections(items);
    expect(s.map((x) => x.key)).toEqual(["overview", "work", "insights"]);
    expect(s[1].items.map((i) => i.href)).toEqual(["/clients", "/tasks"]);
  });
  it("puts every item without a category in Overview", () => {
    expect(buildSections(items)[0].items.map((i) => i.href)).toEqual(["/dashboard", "/dealer-desk"]);
  });
  it("is empty for no items", () => {
    expect(buildSections([])).toEqual([]);
  });
});

describe("badgeText", () => {
  it("is empty for nothing, exact up to 99 and 99+ beyond", () => {
    expect(badgeText(undefined)).toBeNull();
    expect(badgeText(0)).toBeNull();
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });
});

describe("roleLabel and rail cookie", () => {
  it("reads like a role, not an enum", () => {
    expect(roleLabel("ADMIN")).toBe("Admin");
    expect(roleLabel("TEAM_MANAGER")).toBe("Team manager");
  });
  it("names a cookie per person with safe characters only", () => {
    expect(railCookieName("cm1x2y3")).toBe("sidebar_state_cm1x2y3");
    expect(railCookieName("a;b=c d")).toBe("sidebar_state_abcd");
    expect(railCookieName("u1")).not.toBe(railCookieName("u2"));
  });
});

describe("initialOpen", () => {
  it("opens Overview and the section that holds the current page", () => {
    const s = buildSections([item("/dashboard"), item("/clients", "work"), item("/reports", "insights")]);
    expect([...initialOpen(s, (h) => h === "/reports")].sort()).toEqual(["insights", "overview"]);
  });
});
