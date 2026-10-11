import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RELATIONSHIPS } from "@/lib/relationships/registry";

/**
 * Autopilot holds campaign-level facts, proposals, rules and a digest: nothing about a customer, so erasure and merge need no step for it. This pins that:
 * no Autopilot table has a relation or a column that points at a Client, and none is in (or needs to be in) the relationship registry.
 */
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const models = [...schema.matchAll(/^model (Autopilot\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], body: m[2] }));

describe("Autopilot tables have no Client foreign key", () => {
  it("finds the Autopilot models (sanity)", () => {
    expect(models.map((m) => m.name).sort()).toEqual(["AutopilotAuditRun", "AutopilotDataset", "AutopilotDecision", "AutopilotDigest", "AutopilotLaunchDraft", "AutopilotPlan", "AutopilotRecommendation", "AutopilotRule"]);
  });
  it("none relates to Client or carries a client id column", () => {
    for (const m of models) {
      expect(m.body, m.name).not.toMatch(/\bClient\b/);
      expect(m.body, m.name).not.toMatch(/\bclientId\b/i);
      expect(m.body, m.name).not.toMatch(/@relation\(/);
    }
  });
  it("the migrations create no foreign key from an Autopilot table", () => {
    for (const dir of ["20270610000000_autopilot", "20270610000100_autopilot_w3"]) {
      const sql = readFileSync(join(process.cwd(), "prisma/migrations", dir, "migration.sql"), "utf8").replace(/^--.*$/gm, "");
      expect(sql, dir).not.toMatch(/FOREIGN KEY|REFERENCES/i);
    }
  });
  it("so none is in the relationship registry (there is nothing to erase or merge)", () => {
    const registered = new Set(RELATIONSHIPS.map((r) => r.model));
    for (const m of models) expect(registered.has(m.name), m.name).toBe(false);
  });
});
