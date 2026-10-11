import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_ROLES, can, isArea } from "./policy";
import { ACTION_POLICY, API_POLICY, JOB_POLICY, PAGE_POLICY, SURFACES, guardIsOpen, type Guard } from "./surfaces";

/**
 * Default deny, enforced by the file system: every page, every server action and every API route under src/app must have
 * a declared policy, and the source of each must actually carry the guard the policy names. Adding a route without a
 * policy fails here. A policy for a route that no longer exists fails here too.
 */

const APP = join(process.cwd(), "src/app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = walk(APP);
const rel = (f: string) => relative(APP, f).split("\\").join("/");
const read = (f: string) => readFileSync(f, "utf8");

/** "(dashboard)/clients/[id]/page.tsx" -> "/clients/[id]" */
const routeOf = (file: string, leaf: "page.tsx" | "route.ts") =>
  "/" + rel(file).replace(new RegExp(`(^|/)${leaf.replace(".", "\\.")}$`), "").split("/").filter((seg) => seg && !/^\(.*\)$/.test(seg)).join("/");

const pageFiles = files.filter((f) => f.endsWith("/page.tsx"));
const routeFiles = files.filter((f) => f.endsWith("/route.ts"));
const actionFiles = files.filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && /^\s*["']use server["']/m.test(read(f).slice(0, 400)));

const pageRoutes = pageFiles.map((f) => routeOf(f, "page.tsx"));
const apiRoutes = routeFiles.map((f) => routeOf(f, "route.ts"));
const actionKeys = actionFiles.map(rel);

function exportedFunctions(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+const\s+(\w+)\s*=\s*async/gm)) names.add(m[1]);
  return [...names];
}

describe("every page has a declared policy", () => {
  it("finds the pages (sanity)", () => expect(pageRoutes.length).toBeGreaterThan(50));
  it("has no page without a policy", () => {
    expect(pageRoutes.filter((r) => !(r in PAGE_POLICY)).sort()).toEqual([]);
  });
  it("has no policy for a page that does not exist", () => {
    expect(Object.keys(PAGE_POLICY).filter((r) => !pageRoutes.includes(r)).sort()).toEqual([]);
  });
});

describe("every API route has a declared policy", () => {
  it("finds the routes (sanity)", () => expect(apiRoutes.length).toBeGreaterThan(25));
  it("has no route without a policy", () => {
    expect(apiRoutes.filter((r) => !(r in API_POLICY)).sort()).toEqual([]);
  });
  it("has no policy for a route that does not exist", () => {
    expect(Object.keys(API_POLICY).filter((r) => !apiRoutes.includes(r)).sort()).toEqual([]);
  });
});

describe("every server action has a declared policy", () => {
  it("finds the action files (sanity)", () => expect(actionKeys.length).toBeGreaterThan(40));
  it("has no action file without a policy", () => {
    expect(actionKeys.filter((k) => !(k in ACTION_POLICY)).sort()).toEqual([]);
  });
  it("has no policy for an action file that does not exist", () => {
    expect(Object.keys(ACTION_POLICY).filter((k) => !actionKeys.includes(k)).sort()).toEqual([]);
  });
  it("only names functions that the file exports", () => {
    for (const file of actionFiles) {
      const entry = ACTION_POLICY[rel(file)];
      if (!entry?.functions) continue;
      const exported = exportedFunctions(read(file));
      for (const name of Object.keys(entry.functions)) expect(exported, `${rel(file)} ${name}`).toContain(name);
    }
  });
});

/** Roles named in requireRole([...]) literals of a source, "..." spreads and identifiers are reported separately. */
function literalRoleLists(src: string): string[][] {
  const lists: string[][] = [];
  for (const m of src.matchAll(/requireRole\(\s*\[([^\]]*)\]\s*\)/g)) {
    lists.push([...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]));
  }
  return lists;
}

const GUARD_HELPERS = ["requireAccess(", "requireRole(", "requirePartnerWorkspace(", "requireNativePartnerWorkspace(", "authorizeOutcomes(", "apiGuard(", "requireMarketing("];

function checkGuard(key: string, src: string, guard: Guard, label: string, siblings: Guard[] = []) {
  if (guardIsOpen(guard)) return;
  expect(isArea(guard.area), `${label} ${key}: unknown area ${guard.area}`).toBe(true);
  const action = guard.action ?? "view";
  expect(GUARD_HELPERS.some((h) => src.includes(h)), `${label} ${key}: the source calls no guard (${GUARD_HELPERS.join(", ")})`).toBe(true);
  // Every requireAccess("x") in the file names a declared area.
  for (const m of src.matchAll(/requireAccess\(\s*"([\w-]+)"/g)) expect(isArea(m[1]), `${label} ${key}: requireAccess("${m[1]}") is not a registry area`).toBe(true);
  // A literal role list must never let in a role the registry refuses for this area and action.
  for (const roles of literalRoleLists(src)) {
    for (const role of roles) {
      const allowed = [guard, ...siblings].some((g) => !guardIsOpen(g) && can(role, g.area, g.action ?? "view"));
      expect(allowed, `${label} ${key}: requireRole lists ${role}, the registry refuses it for ${guard.area}.${action}`).toBe(true);
    }
  }
}

describe("each source carries the guard its policy names", () => {
  it("pages", () => {
    for (const f of pageFiles) {
      const key = routeOf(f, "page.tsx");
      const guard = PAGE_POLICY[key];
      if (guard) checkGuard(key, read(f), guard, "page");
    }
  });
  it("API routes", () => {
    for (const f of routeFiles) {
      const key = routeOf(f, "route.ts");
      const guard = API_POLICY[key];
      if (guard) checkGuard(key, read(f), guard, "api");
    }
  });
  it("server actions: no bare requireUser() on an area-guarded file", () => {
    for (const f of actionFiles) {
      const key = rel(f);
      const entry = ACTION_POLICY[key];
      if (!entry) continue;
      const src = read(f);
      const open = guardIsOpen(entry.default);
      checkGuard(key, src, entry.default, "action", Object.values(entry.functions ?? {}));
      for (const [name, guard] of Object.entries(entry.functions ?? {})) {
        if (!guardIsOpen(guard)) expect(isArea(guard.area), `${key} ${name}`).toBe(true);
      }
      if (!open) {
        // requireUser() proves only that someone is signed in. It is allowed in an area-guarded file only for functions the policy marks open.
        const bare = [...src.matchAll(/requireUser\(\)/g)].length;
        const openFns = Object.values(entry.functions ?? {}).filter(guardIsOpen).length;
        expect(bare, `${key}: ${bare} bare requireUser() calls but only ${openFns} functions declared open`).toBeLessThanOrEqual(openFns);
      }
    }
  });
});

describe("marketing screens go through the one marketing helper", () => {
  const MARKETING_ONLY_AREAS = ["marketing", "marketing-creative", "marketing-social", "marketing-competitor-ads", "marketing-experiments", "marketing-autopilot", "marketing-attribution", "marketing-reports"];
  it("every page, action and route in a marketing-only area calls requireMarketing()", () => {
    for (const f of pageFiles) {
      const g = PAGE_POLICY[routeOf(f, "page.tsx")];
      if (g && !guardIsOpen(g) && MARKETING_ONLY_AREAS.includes(g.area)) expect(read(f), rel(f)).toContain("requireMarketing(");
    }
    for (const f of actionFiles) {
      const e = ACTION_POLICY[rel(f)];
      if (e && !guardIsOpen(e.default) && MARKETING_ONLY_AREAS.includes(e.default.area)) expect(read(f), rel(f)).toContain("requireMarketing(");
    }
  });
  it("no marketing source carries its own role list for MANAGER or RM", () => {
    for (const f of [...pageFiles, ...actionFiles].filter((x) => rel(x).includes("marketing"))) expect(read(f), rel(f)).not.toMatch(/requireRole\(\[[^\]]*"(MANAGER|RM)"/);
  });
});

describe("the other surfaces name a real area", () => {
  it("Cmd+K, Ask, Co-pilot, exports, notifications, report links and jobs are all in the registry", () => {
    for (const [id, s] of Object.entries(SURFACES)) {
      expect(isArea(s.area), `${id}: ${s.area}`).toBe(true);
      expect(s.kind.length).toBeGreaterThan(0);
    }
  });
  it("covers every kind the owner listed", () => {
    const kinds = new Set(Object.values(SURFACES).map((s) => s.kind));
    for (const k of ["nav", "search", "ask", "copilot", "notification", "export", "share-link", "job", "loader"]) expect(kinds.has(k as never), k).toBe(true);
  });
  it("roles are a closed set", () => expect(ALL_ROLES.length).toBeGreaterThan(8));
});

describe("every scheduled job has a declared audience", () => {
  const tick = readFileSync(join(APP, "api/internal/cron/tick/route.ts"), "utf8");
  const jobs = [...tick.matchAll(/runJob\("([^"]+)"/g)].map((m) => m[1]);
  it("finds the jobs (sanity)", () => expect(jobs.length).toBeGreaterThan(20));
  it("has no job without a policy", () => expect(jobs.filter((n) => !(n in JOB_POLICY)).sort()).toEqual([]));
  it("has no policy for a job that is gone", () => expect(Object.keys(JOB_POLICY).filter((n) => !jobs.includes(n)).sort()).toEqual([]));
  it("sends marketing job output only to marketing viewers", () => {
    for (const name of ["meta-ads-sync", "google-ads-sync"]) {
      const g = JOB_POLICY[name];
      expect("area" in g && can("RM", g.area)).toBe(false);
      expect("area" in g && can("MARKETING", g.area)).toBe(true);
    }
  });
});
