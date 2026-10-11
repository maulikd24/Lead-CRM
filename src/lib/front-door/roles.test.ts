import { describe, expect, it } from "vitest";

import { can } from "@/lib/access/policy";

import { CUSTOMERS, ROLE_HOME, STORY_STEPS } from "./fixtures";
import { TOUR_ROLES, probesFor, sidebarFor } from "./roles";

const labels = (key: Parameters<typeof sidebarFor>[0]) => sidebarFor(key).flatMap((g) => g.items);
const probe = (key: Parameters<typeof probesFor>[0], label: RegExp) => probesFor(key).find((p) => label.test(p.label))!;

describe("front-door role tours are derived from the real access registry", () => {
  it("covers RM, Marketing, Management, Admin and the control plane", () => {
    expect(TOUR_ROLES.map((r) => r.key)).toEqual(["rm", "marketing", "management", "admin", "control-plane"]);
  });
  it("proves segregation with the live registry: Marketing never reaches customers, RM never reaches spend", () => {
    expect(probe("marketing", /Customer/).allowed).toBe(false);
    expect(probe("marketing", /Inbox/).allowed).toBe(false);
    expect(probe("marketing", /spend/i).allowed).toBe(true);
    expect(probe("rm", /Customer/).allowed).toBe(true);
    expect(probe("rm", /spend/i).allowed).toBe(false);
    for (const key of ["rm", "marketing", "management", "admin"] as const) {
      for (const p of probesFor(key)) expect(p.allowed).toBe(can(TOUR_ROLES.find((r) => r.key === key)!.role, p.area, "view"));
    }
  });
  it("shows the real sidebar of each role (Marketing has no customer pages, RM has no marketing pages)", () => {
    expect(labels("marketing").some((l) => /clients|inbox|calls/i.test(l))).toBe(false);
    expect(labels("marketing").some((l) => /marketing/i.test(l))).toBe(true);
    expect(labels("rm").some((l) => /marketing/i.test(l))).toBe(false);
    expect(labels("rm").some((l) => /clients/i.test(l))).toBe(true);
    expect(labels("admin").length).toBeGreaterThan(labels("rm").length);
  });
});

describe("synthetic fixtures keep the segregation they claim", () => {
  const rmText = JSON.stringify(ROLE_HOME.rm);
  const marketingText = JSON.stringify(ROLE_HOME.marketing);
  it("the Marketing home never names a customer", () => {
    for (const c of CUSTOMERS) {
      expect(marketingText).not.toContain(c.name);
      expect(marketingText).not.toContain(c.name.split(" ")[0]);
    }
  });
  it("the RM home never shows spend, cost per lead or return on ad spend", () => {
    expect(rmText).not.toMatch(/spend|cost per|roas|budget|campaign/i);
  });
  it("every fixture is labelled synthetic and carries no performance or return claim", () => {
    const all = JSON.stringify({ ROLE_HOME, STORY_STEPS, CUSTOMERS });
    expect(all).not.toMatch(/\b(returns?|outperform|guarantee|alpha|cagr|xirr)\b/i);
    for (const r of Object.values(ROLE_HOME)) expect(r.syntheticNote).toMatch(/synthetic/i);
  });
  it("the story has six steps and the scripted example", () => {
    expect(STORY_STEPS).toHaveLength(6);
    const text = JSON.stringify(STORY_STEPS);
    expect(text).toContain("Fix the complaint");
    expect(text).toMatch(/PMS follow-up/);
    expect(text).toMatch(/first-trade nudge/i);
  });
});
