import { Gift } from "lucide-react";
import { describe, expect, it } from "vitest";

import type { NavItem } from "@/lib/nav-items";
import { activeNavHref, badgeText, buildSections, navStateKey, parseRemembered, railCookieName, resolveOpen, roleLabel } from "./nav-sections";

const item = (href: string, category?: NavItem["category"]): NavItem => ({ href, label: href, icon: Gift, roles: ["ADMIN"], category });

describe("buildSections", () => {
  const items = [item("/dashboard"), item("/clients", "customers"), item("/tasks", "customers"), item("/reports", "insights"), item("/dealer-desk")];
  it("emits a section where its first item appears and keeps the order inside it", () => {
    const s = buildSections(items);
    expect(s.map((x) => x.key)).toEqual(["overview", "customers", "insights"]);
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
    expect(roleLabel("RM")).toBe("RM");  });
  it("names a cookie per person with safe characters only", () => {
    expect(railCookieName("cm1x2y3")).toBe("sidebar_state_cm1x2y3");
    expect(railCookieName("a;b=c d")).toBe("sidebar_state_abcd");
    expect(railCookieName("u1")).not.toBe(railCookieName("u2"));
  });
});

describe("resolveOpen", () => {
  const s = buildSections([item("/dashboard"), item("/clients", "customers"), item("/reports", "insights"), item("/settings/users", "administration")]);
  const none = () => false;
  it("opens every working section and Overview, and tucks the long admin list away", () => {
    expect([...resolveOpen(s, {}, none)].sort()).toEqual(["customers", "insights", "overview"]);
  });
  it("reveals the section holding the current page even when it is tucked away", () => {
    expect(resolveOpen(s, {}, (h) => h === "/settings/users").has("administration")).toBe(true);
  });
  it("lets a person's own choice win, both ways", () => {
    const open = resolveOpen(s, { customers: false, administration: true }, none);
    expect(open.has("customers")).toBe(false);
    expect(open.has("administration")).toBe(true);
  });
});

describe("activeNavHref", () => {
  const hrefs = ["/partners", "/partners/payouts", "/clients", "/clients/duplicates"];
  it("picks the most specific item so two never light up together", () => {
    expect(activeNavHref("/partners/payouts", hrefs)).toBe("/partners/payouts");
    expect(activeNavHref("/partners/payouts/p1", hrefs)).toBe("/partners/payouts");
    expect(activeNavHref("/partners", hrefs)).toBe("/partners");
    expect(activeNavHref("/partners/network", hrefs)).toBe("/partners");
    expect(activeNavHref("/clients/c1/360", hrefs)).toBe("/clients");
    expect(activeNavHref("/clients/duplicates", hrefs)).toBe("/clients/duplicates");
  });
  it("does not treat a longer word as a child", () => {
    expect(activeNavHref("/clientsx", hrefs)).toBeNull();
    expect(activeNavHref("/settings", hrefs)).toBeNull();
  });
});

describe("remembered state", () => {
  it("keeps only booleans and survives garbage", () => {
    expect(parseRemembered('{"a":true,"b":false,"c":1,"d":"x"}')).toEqual({ a: true, b: false });
    expect(parseRemembered("not json")).toEqual({});
    expect(parseRemembered("[true]")).toEqual({});
    expect(parseRemembered(null)).toEqual({});
  });
  it("keys the layout per person", () => {
    expect(navStateKey("A@x.co")).toBe(navStateKey("a@x.co"));
    expect(navStateKey("a@x.co")).not.toBe(navStateKey("b@x.co"));
  });
});
