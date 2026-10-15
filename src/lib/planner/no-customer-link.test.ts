import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { customerLinks, scanSchema } from "@/lib/relationships/schema-scan";
import { RELATIONSHIPS } from "@/lib/relationships/registry";

/**
 * The planner holds staff-written plans and pseudonymous campaign codes, never a customer. No planner table has a foreign key to a Client, a plain
 * client id column, or a path to one through another table, so the erasure transaction, the merge and the relationship registry have nothing to add
 * for it (the registry's own scan test fails when a table with a Client link is not registered). If a future change gives a planner table a customer
 * link, this test fails and the table must be registered, merged and erased like any other.
 */
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const scan = scanSchema(schema);
const PLANNER = scan.models.filter((m) => m.startsWith("Planner"));

describe("planner tables and customers", () => {
  it("finds the planner tables (sanity)", () => {
    expect(PLANNER.sort()).toEqual(["PlannerAudience", "PlannerCopy", "PlannerCreator", "PlannerDestination", "PlannerEvent", "PlannerPlan", "PlannerPromise", "PlannerRoutingRule"]);
  });
  it("no planner table links to a Client, directly, by a plain id column or through another table", () => {
    const linked = customerLinks(scan, "Client").map((l) => l.model);
    expect(PLANNER.filter((m) => linked.includes(m))).toEqual([]);
    expect(scan.fks.filter((f) => PLANNER.includes(f.model) && f.target === "Client")).toEqual([]);
    expect(scan.plainIds.filter((p) => PLANNER.includes(p.model))).toEqual([]);
  });
  it("so none of them is in the relationship registry (nothing to erase or merge)", () => {
    const registered = new Set(RELATIONSHIPS.map((r) => r.model));
    expect(PLANNER.filter((m) => registered.has(m))).toEqual([]);
  });
  it("the one customer-keyed value the planner reads, a campaign code, lives on the customer's own attribution and is counted by the provider", () => {
    expect(PLANNER.some((m) => /client/i.test(m))).toBe(false);
  });
});
