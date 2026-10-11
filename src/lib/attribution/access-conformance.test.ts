import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { AREAS, can } from "@/lib/access/policy";
import { JOB_POLICY, PAGE_POLICY, ACTION_POLICY, SURFACES } from "@/lib/access/surfaces";

/**
 * Attribution is governed by the central policy registry and by nothing else: no private role list, no private
 * marketing-access copy, no private pseudonymiser. These tests pin that.
 */
const SRC = join(process.cwd(), "src");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
};
const rel = (f: string) => relative(SRC, f).split("\\").join("/");
const attributionFiles = [
  ...walk(join(SRC, "lib/attribution")),
  ...walk(join(SRC, "app/(dashboard)/settings/lead-leakage")),
  ...walk(join(SRC, "components/attribution")),
  join(SRC, "app/(dashboard)/marketing/impact-tab.tsx"),
  join(SRC, "app/(dashboard)/marketing/impact-view.tsx"),
];

describe("attribution areas in the central registry", () => {
  it("Campaign impact, Lead leakage and cost numbers: ADMIN and MARKETING only", () => {
    for (const role of ["ADMIN", "MARKETING"]) {
      expect(can(role, "marketing-attribution", "view")).toBe(true);
      expect(can(role, "marketing-attribution", "export")).toBe(true);
    }
    for (const role of ["MANAGER", "RM", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"]) {
      for (const action of ["view", "manage", "export"] as const) expect(can(role, "marketing-attribution", action), `${role} ${action}`).toBe(false);
    }
  });
  it("the SLA settings are ADMIN only: MARKETING may view, never manage", () => {
    expect(can("ADMIN", "marketing-attribution", "manage")).toBe(true);
    expect(can("MARKETING", "marketing-attribution", "manage")).toBe(false);
  });
  it("RMs see a lead's campaign label and nothing more, through the label area", () => {
    expect(can("RM", "lead-campaign-label", "view")).toBe(true);
    expect(can("MARKETING", "lead-campaign-label", "view")).toBe(false);
    expect(AREAS["marketing-attribution"].group).toBe("marketing");
  });
  it("every attribution surface is declared", () => {
    expect(PAGE_POLICY["/settings/lead-leakage"]).toEqual({ area: "marketing-attribution", action: "view" });
    expect(ACTION_POLICY["(dashboard)/settings/lead-leakage/actions.ts"]?.default).toEqual({ area: "marketing-attribution", action: "manage" });
    expect(JOB_POLICY["lead-push-sweep"]).toBeDefined();
    expect(SURFACES["loader.campaign-outcomes"]).toMatchObject({ kind: "loader", area: "marketing-attribution" });
  });
});

describe("no private access logic in attribution", () => {
  it("has no private marketing-access module", () => {
    expect(attributionFiles.map(rel).filter((f) => /marketing-access/.test(f))).toEqual([]);
  });
  it("names no role literal: every decision goes through the registry or canAccessMarketing", () => {
    for (const f of attributionFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).not.toMatch(/role\s*(===|!==|==)\s*"(ADMIN|MARKETING|RM|MANAGER)"/);
      expect(src, rel(f)).not.toMatch(/requireRole\(/);
      expect(src, rel(f)).not.toMatch(/requireUser\(/);
    }
  });
  it("has no private hashing for stand-ins: the access module's pseudonymiser is the only one", () => {
    for (const f of attributionFiles) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/createHash|createHmac/);
  });
});
