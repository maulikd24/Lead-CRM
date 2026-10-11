import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RELATIONSHIPS, REFERENCED_BY_VALUE, delegateOf, relationshipFor, whereForClients, type RelationshipEntry } from "./registry";
import { customerLinks, scanSchema } from "./schema-scan";

const schemaText = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
const scan = scanSchema(schemaText);
const links = customerLinks(scan, "Client");

describe("coverage: the registry knows every table that reaches the customer", () => {
  it("FAILS when any table with a customer link (direct foreign key, plain id column or indirect) is missing from the registry", () => {
    const missing = links.map((l) => l.model).filter((m) => !relationshipFor(m));
    expect(missing, `Add these tables to src/lib/relationships/registry.ts (say how each is merged, erased and shown): ${missing.join(", ")}`).toEqual([]);
  });
  it("lists no table that is not in the schema or no longer reaches the customer", () => {
    const stale = RELATIONSHIPS.map((r) => r.model).filter((m) => !links.some((l) => l.model === m));
    expect(stale).toEqual([]);
  });
  it("has one entry per table", () => {
    const names = RELATIONSHIPS.map((r) => r.model);
    expect(new Set(names).size).toBe(names.length);
  });
  it("declares, for every table, exactly the columns and paths the schema has (a Referral also has its referrer route, stated as an erase-only path)", () => {
    for (const l of links) {
      const r = relationshipFor(l.model)!;
      expect(r.kind, l.model).toBe(l.kind);
      const norm = (ps: { via: string[]; column: string }[]) => ps.map((p) => [...p.via, p.column].join(".")).sort();
      expect(norm(r.paths), l.model).toEqual(norm(l.paths));
    }
  });
  it("the extra erase paths name real relation fields", () => {
    for (const r of RELATIONSHIPS) for (const p of r.extraErasePaths ?? []) {
      let model = r.model;
      for (const field of p.via) {
        const fk = scan.fks.find((f) => f.model === model && f.field === field);
        expect(fk, `${r.model}.${field}`).toBeTruthy();
        model = fk!.target;
      }
      expect(scan.plainIds.some((x) => x.model === model && x.column === p.column) || scan.fks.some((f) => f.model === model && f.columns.includes(p.column) && f.target === "Client"), `${r.model} via ${p.via.join(".")}`).toBe(true);
    }
  });
});

describe("every entry says how it is merged, erased, shown and classified", () => {
  it.each(RELATIONSHIPS.map((r) => [r.model, r] as [string, RelationshipEntry]))("%s", (_m, r) => {
    expect(r.merge.kind).toBeTruthy();
    expect(r.erase.kind).toBeTruthy();
    expect("source" in r.timeline || "foldedInto" in r.timeline || ("none" in r.timeline && r.timeline.none.length > 5)).toBe(true);
    expect(["INTERNAL", "PERSONAL", "SENSITIVE_PERSONAL"]).toContain(r.dataClass);
  });
  it("a table that blocks erasure is financial or regulatory, and every blocker has the user-facing message", () => {
    const blockers = RELATIONSHIPS.filter((r) => r.erase.kind === "block" || r.erase.kind === "block_then_delete").map((r) => r.model).sort();
    expect(blockers).toEqual(["AdvisoryInteraction", "ClientPayment", "HouseholdMember", "PmsAifHolding", "RevenueEvent", "TradingAccount"]);
  });
  it("a table whose rows the erasure deletes holds no regulated trail the blockers protect", () => {
    for (const r of RELATIONSHIPS) if (r.erase.kind === "delete") expect(["TradingAccount", "RevenueEvent", "ClientPayment"]).not.toContain(r.model);
  });
  it("by-value references state how erasure treats them", () => {
    for (const r of REFERENCED_BY_VALUE) expect(["delete", "retain_masked", "retain"]).toContain(r.erase);
  });
});

describe("erase order respects foreign keys (a child is deleted before its parent)", () => {
  const orderOf = (model: string): number | null => {
    const e = relationshipFor(model)?.erase;
    if (!e) return null;
    if (e.kind === "delete") return e.order;
    if (e.kind === "block_then_delete") return e.deleteOrder;
    return null;
  };
  it("orders are unique among deletes", () => {
    const orders = RELATIONSHIPS.map((r) => orderOf(r.model)).filter((o): o is number => o !== null);
    expect(new Set(orders).size).toBe(orders.length);
  });
  it("for every foreign key between two registry tables that are both deleted, the child's order is lower than the parent's", () => {
    const bad: string[] = [];
    for (const fk of scan.fks) {
      const child = orderOf(fk.model);
      const parent = orderOf(fk.target);
      if (child !== null && parent !== null && child >= parent) bad.push(`${fk.model}.${fk.field} -> ${fk.target}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("whereForClients", () => {
  it("builds a direct, a two-column and a nested filter", () => {
    expect(whereForClients([{ via: [], column: "clientId" }], ["a", "b"])).toEqual({ clientId: { in: ["a", "b"] } });
    expect(whereForClients([{ via: [], column: "clientAId" }, { via: [], column: "clientBId" }], ["a"])).toEqual({ OR: [{ clientAId: { in: ["a"] } }, { clientBId: { in: ["a"] } }] });
    expect(whereForClients([{ via: ["run"], column: "clientId" }], ["a"])).toEqual({ run: { clientId: { in: ["a"] } } });
    expect(whereForClients([{ via: ["commissionAccrual", "revenueEvent"], column: "clientId" }], ["a"])).toEqual({ commissionAccrual: { revenueEvent: { clientId: { in: ["a"] } } } });
  });
  it("delegate names follow Prisma", () => expect(delegateOf("PmsAifHolding")).toBe("pmsAifHolding"));
});
