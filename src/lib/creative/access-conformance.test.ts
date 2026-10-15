import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { AREAS, can } from "@/lib/access/policy";
import { notificationAllowed } from "@/lib/access/notification-policy";
import { ACTION_POLICY, JOB_POLICY, PAGE_POLICY, SURFACES } from "@/lib/access/surfaces";

/**
 * Creative intelligence and director reports are governed by the central policy registry and by nothing else: no private role list, no
 * private marketing-access copy, no private hashing of people. ADMIN and MARKETING only; the share-link page is the one unauthenticated
 * surface and is registered as a named public surface (see lib/access/public-surfaces.test.ts).
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
const APP = "app/(dashboard)/marketing";
const creativeFiles = [
  ...walk(join(SRC, "lib/creative")), ...walk(join(SRC, "lib/director")), ...walk(join(SRC, "lib/guardrails")), ...walk(join(SRC, "components/creative")),
  ...walk(join(SRC, "app/creative-print")), ...walk(join(SRC, "app/report-print")), ...walk(join(SRC, "app/shared")),
  ...["ad-preview", "brand-form", "briefs-tab", "briefs-view", "competitors-tab", "competitors-view", "creative-actions", "creative-gate", "creative-ui", "experiments-tab", "experiments-view", "insights-tab", "insights-view", "new-brief-form", "report-actions", "reports-tab", "reports-view", "variant-card"]
    .map((n) => join(SRC, APP, `${n}.ts`)).concat(["ad-preview", "brand-form", "briefs-tab", "briefs-view", "competitors-tab", "competitors-view", "creative-ui", "experiments-tab", "experiments-view", "insights-tab", "insights-view", "new-brief-form", "reports-tab", "reports-view", "variant-card"].map((n) => join(SRC, APP, `${n}.tsx`))),
].filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });

describe("creative and report areas in the central registry", () => {
  const AREAS_UNDER_TEST = ["marketing-creative", "marketing-competitor-ads", "marketing-experiments", "marketing-reports"] as const;
  it("ADMIN and MARKETING hold them; no other role holds any action on any of them", () => {
    for (const area of AREAS_UNDER_TEST) {
      expect(can("ADMIN", area, "view"), `ADMIN ${area}`).toBe(true);
      expect(can("MARKETING", area, "view"), `MARKETING ${area}`).toBe(true);
      for (const role of ["MANAGER", "RM", "FINANCE", "DEALER", "TEAM_MANAGER", "PARTNER", "AFFILIATE", "DISTRIBUTOR"]) {
        for (const action of ["view", "manage", "export"] as const) expect(can(role, area, action), `${role} ${area} ${action}`).toBe(false);
      }
      expect(AREAS[area].group).toBe("marketing");
    }
  });
  it("the digest settings are ADMIN only: MARKETING may use reports (view, export), never manage them", () => {
    expect(can("MARKETING", "marketing-reports", "export")).toBe(true);
    expect(can("MARKETING", "marketing-reports", "manage")).toBe(false);
    expect(can("ADMIN", "marketing-reports", "manage")).toBe(true);
  });
});

describe("every creative and report surface is declared", () => {
  it("pages", () => {
    expect(PAGE_POLICY["/creative-print/[briefId]"]).toEqual({ area: "marketing-creative", action: "view" });
    expect(PAGE_POLICY["/report-print"]).toEqual({ area: "marketing-reports", action: "export" });
    expect(PAGE_POLICY["/shared/report/[token]"]).toMatchObject({ open: "credential" });
  });
  it("server actions, with the narrower areas where the work is not plain creative", () => {
    const c = ACTION_POLICY["(dashboard)/marketing/creative-actions.ts"];
    expect(c.default).toEqual({ area: "marketing-creative", action: "manage" });
    for (const fn of ["addCompetitorAction", "removeCompetitorAction", "addCompetitorAdAction", "importCompetitorCsvAction", "setCompetitorAdTagsAction", "removeCompetitorAdAction"]) expect(c.functions?.[fn], fn).toEqual({ area: "marketing-competitor-ads", action: "manage" });
    for (const fn of ["saveExperimentAction", "deleteExperimentAction"]) expect(c.functions?.[fn], fn).toEqual({ area: "marketing-experiments", action: "manage" });
    expect(c.functions?.setAiCreativeAction).toEqual({ area: "settings-ai", action: "manage" });
    const r = ACTION_POLICY["(dashboard)/marketing/report-actions.ts"];
    expect(r.default).toEqual({ area: "marketing-reports", action: "export" });
    expect(r.functions?.saveDigestSettingsAction).toEqual({ area: "marketing-reports", action: "manage" });
    expect(r.functions?.saveApprovalSettingsAction).toEqual({ area: "marketing-reports", action: "manage" });
  });
  it("the weekly digest job, its notification and the share link", () => {
    expect(JOB_POLICY["director-digest"]).toEqual({ area: "marketing-reports" });
    expect(notificationAllowed("MARKETING", "marketing_weekly_digest")).toBe(true);
    expect(notificationAllowed("RM", "marketing_weekly_digest")).toBe(false);
    expect(notificationAllowed("MANAGER", "marketing_weekly_digest")).toBe(false);
    expect(SURFACES["share.marketing-report-link"]).toMatchObject({ kind: "share-link", area: "marketing-reports" });
  });
});

describe("no private access logic in creative or the director reports", () => {
  it("finds the files (sanity)", () => expect(creativeFiles.length).toBeGreaterThan(45));
  it("has no private marketing-access module", () => {
    expect(creativeFiles.map(rel).filter((f) => /marketing-access/.test(f))).toEqual([]);
  });
  it("names no role literal and no private role list: every decision goes through the registry", () => {
    for (const f of creativeFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, rel(f)).not.toMatch(/role\s*(===|!==|==)\s*"(ADMIN|MARKETING|RM|MANAGER)"/);
      expect(src, rel(f)).not.toMatch(/requireRole\(/);
      expect(src, rel(f)).not.toMatch(/requireUser\(/);
      expect(src, rel(f)).not.toMatch(/canAccessMarketing/);
    }
  });
  it("has no private hashing of people: no pseudonymiser here (the share token digest and the annexure's content fingerprint are the only hashes)", () => {
    const offenders = creativeFiles.filter((f) => /createHash|createHmac|sha256/i.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual(["lib/creative/fingerprint.ts", "lib/director/share.ts"]);
  });
  it("every marketing action file calls the one marketing helper itself", () => {
    for (const file of ["creative-actions.ts", "report-actions.ts"]) expect(readFileSync(join(SRC, APP, file), "utf8"), file).toContain("requireMarketing(");
  });
  it("each exported action opens the gate for exactly the area its policy names", () => {
    for (const [file, key] of [["creative-actions.ts", "(dashboard)/marketing/creative-actions.ts"], ["report-actions.ts", "(dashboard)/marketing/report-actions.ts"]] as const) {
      const src = readFileSync(join(SRC, APP, file), "utf8");
      const entry = ACTION_POLICY[key];
      const chunks = src.split(/(?=^export async function )/m).filter((c) => c.startsWith("export async function"));
      expect(chunks.length, file).toBeGreaterThan(3);
      for (const chunk of chunks) {
        const name = /^export async function (\w+)/.exec(chunk)![1];
        const guard = entry.functions?.[name] ?? entry.default;
        if (!("area" in guard)) throw new Error(`${name} is open`);
        const m = /await gate\("([\w-]+)"(?:, "(\w+)")?\)/.exec(chunk);
        expect(m, `${file} ${name} opens no gate`).not.toBeNull();
        expect(m![1], `${file} ${name}`).toBe(guard.area);
        expect(m![2] ?? (file === "report-actions.ts" ? "export" : "manage"), `${file} ${name} action`).toBe(guard.action ?? "view");
      }
    }
  });
});
