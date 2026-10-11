import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { AREAS, can } from "@/lib/access/policy";
import { ACTION_POLICY, JOB_POLICY, PAGE_POLICY, SURFACES } from "@/lib/access/surfaces";
import { NOTIFICATION_AREA } from "@/lib/access/notification-policy";

/** Autopilot is governed by the central policy registry and by nothing else: no private role list, no private marketing-access copy, no private pseudonymiser. */
const SRC = join(process.cwd(), "src");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/\.testkit\.ts$/.test(name)) out.push(full);
  }
  return out;
};
const rel = (f: string) => relative(SRC, f).split("\\").join("/");
const files = [...walk(join(SRC, "lib/autopilot")), ...walk(join(SRC, "app/(dashboard)/autopilot"))];
const read = (f: string) => readFileSync(f, "utf8");
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the Autopilot area in the central registry", () => {
  it("ADMIN and MARKETING only, for view and manage", () => {
    for (const role of ["ADMIN", "MARKETING"]) for (const a of ["view", "manage"] as const) expect(can(role, "marketing-autopilot", a), `${role} ${a}`).toBe(true);
    for (const role of ["MANAGER", "TEAM_MANAGER", "RM", "FINANCE", "DEALER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"]) for (const a of ["view", "manage", "export"] as const) expect(can(role, "marketing-autopilot", a), `${role} ${a}`).toBe(false);
    expect(AREAS["marketing-autopilot"].group).toBe("marketing");
  });
  it("every Autopilot page, action file, loader, job and notification is declared", () => {
    expect(PAGE_POLICY["/autopilot"]).toEqual({ area: "marketing-autopilot", action: "view" });
    expect(ACTION_POLICY["(dashboard)/autopilot/actions.ts"]?.default).toEqual({ area: "marketing-autopilot", action: "manage" });
    expect(SURFACES["loader.autopilot"]).toMatchObject({ kind: "loader", area: "marketing-autopilot" });
    for (const job of ["autopilot-daily-audit", "autopilot-weekly-digest"]) expect(JOB_POLICY[job], job).toEqual({ area: "marketing-autopilot" });
    expect(NOTIFICATION_AREA.autopilot_digest).toBe("marketing-autopilot");
  });
});

describe("no private access logic in Autopilot", () => {
  it("has no marketing-access module, no role literal and no requireRole or requireUser", () => {
    expect(files.map(rel).filter((f) => /marketing-access|\/access\.ts$/.test(f))).toEqual([]);
    const offenders = files.filter((f) => /\b(requireRole|requireUser|requireSession|canAccessMarketing)\s*\(|["'](ADMIN|MARKETING|RM|MANAGER|FINANCE)["']/.test(strip(read(f)))).map(rel);
    expect(offenders).toEqual([]);
  });
  it("the page and the actions gate through requireMarketing for the Autopilot area", () => {
    for (const f of ["app/(dashboard)/autopilot/page.tsx", "app/(dashboard)/autopilot/actions.ts"]) {
      expect(read(join(SRC, f)), f).toMatch(/requireMarketing\(\s*"marketing-autopilot"/);
    }
  });
  it("has no pseudonymiser, hash or HMAC of its own (the shared one is lib/access/pseudonym; lead cohorts arrive already coarse from the provider)", () => {
    const offenders = files.filter((f) => /createHash|createHmac|sha256|pseudonymi[sz]e\s*\(/i.test(strip(read(f)))).map(rel);
    expect(offenders).toEqual([]);
  });
});
