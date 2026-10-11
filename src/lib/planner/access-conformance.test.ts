import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { AREAS, can } from "@/lib/access/policy";
import { ACTION_POLICY, JOB_POLICY, PAGE_POLICY } from "@/lib/access/surfaces";

/**
 * The planner is governed by the central policy registry and by nothing else: no private role list and no private marketing-access
 * copy. These tests pin that, and the one access difference inside the planner (registry edits are Admin only).
 */
const SRC = join(process.cwd(), "src");
const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
};
const rel = (f: string) => relative(SRC, f).split("\\").join("/");
const plannerFiles = [...walk(join(SRC, "lib/planner")), ...walk(join(SRC, "app/(dashboard)/planner")), ...walk(join(SRC, "components/planner"))];

describe("planner areas in the central registry", () => {
  it("the planner is ADMIN and MARKETING only, for every action", () => {
    for (const role of ["ADMIN", "MARKETING"]) for (const a of ["view", "manage"] as const) expect(can(role, "marketing-planner", a), `${role} ${a}`).toBe(true);
    for (const role of ["MANAGER", "RM", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"]) {
      for (const a of ["view", "manage", "export"] as const) expect(can(role, "marketing-planner", a), `${role} ${a}`).toBe(false);
    }
    expect(AREAS["marketing-planner"].group).toBe("marketing");
  });
  it("registry edits (creators with their SEBI number, destinations, routing rules) are Admin only; Marketing may view", () => {
    expect(can("ADMIN", "marketing-planner-registry", "manage")).toBe(true);
    expect(can("MARKETING", "marketing-planner-registry", "manage")).toBe(false);
    expect(can("MARKETING", "marketing-planner-registry", "view")).toBe(true);
    for (const role of ["MANAGER", "RM", "FINANCE"]) expect(can(role, "marketing-planner-registry", "view")).toBe(false);
  });
  it("every planner surface is declared", () => {
    expect(PAGE_POLICY["/planner"]).toEqual({ area: "marketing-planner", action: "view" });
    expect(PAGE_POLICY["/planner/new"]).toEqual({ area: "marketing-planner", action: "manage" });
    expect(PAGE_POLICY["/planner/[id]"]).toEqual({ area: "marketing-planner", action: "view" });
    const actions = ACTION_POLICY["(dashboard)/planner/actions.ts"];
    expect(actions?.default).toEqual({ area: "marketing-planner", action: "manage" });
    for (const fn of ["saveDestinationAction", "saveCreatorAction", "saveRuleAction", "deleteRuleAction", "runHealthChecksAction"]) expect(actions?.functions?.[fn], fn).toEqual({ area: "marketing-planner-registry", action: "manage" });
    expect(JOB_POLICY["planner-destination-health"]).toEqual({ area: "marketing-planner" });
  });
});

describe("no private access logic in the planner", () => {
  it("has no private marketing-access module", () => {
    expect(plannerFiles.map(rel).filter((f) => /marketing-access|require-role/.test(f))).toEqual([]);
    expect(existsSync(join(SRC, "lib/planner/marketing-access.ts"))).toBe(false);
  });
  it("names no role literal: every decision goes through the registry or canAccessMarketing", () => {
    for (const f of plannerFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).not.toMatch(/role\s*(===|!==|==)\s*"(ADMIN|MARKETING|RM|MANAGER)"/);
      expect(src, rel(f)).not.toMatch(/requireRole\(/);
      expect(src, rel(f)).not.toMatch(/requireUser\(/);
      expect(src, rel(f)).not.toMatch(/\[\s*"ADMIN"\s*,\s*"MARKETING"\s*\]/);
    }
  });
});
