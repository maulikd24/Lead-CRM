import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { W2B_CLIENT_TABLES } from "./w2b-client-tables";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const migration = read("prisma/migrations/20270480000000_w2b_memory_service_households/migration.sql");
const erasure = read("src/app/(dashboard)/settings/data-privacy/actions.ts");
const merge = read("src/lib/clients/merge.ts");

describe("every table this workstream added with a Client foreign key is registered, erased and merged", () => {
  const fkTables = [...migration.matchAll(/ALTER TABLE "(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY \("(\w+)"\) REFERENCES "Client"/g)].map((m) => ({ table: m[1], column: m[2] }));

  it("the migration really adds Client foreign keys (sanity)", () => {
    expect(fkTables.length).toBeGreaterThanOrEqual(5);
  });
  it("the registry lists exactly those tables and columns", () => {
    const fromSql = [...new Set(fkTables.map((f) => f.table))].sort();
    expect(W2B_CLIENT_TABLES.map((t) => t.model).sort()).toEqual(fromSql);
    for (const t of W2B_CLIENT_TABLES) expect([...t.clientColumns].sort(), t.model).toEqual(fkTables.filter((f) => f.table === t.model).map((f) => f.column).sort());
  });
  it.each(W2B_CLIENT_TABLES.map((t) => [t.model, t] as const))("%s is deleted in the erasure transaction", (_m, t) => {
    expect(erasure).toContain(`tx.${t.delegate}.deleteMany`);
  });
  it.each(W2B_CLIENT_TABLES.map((t) => [t.model, t] as const))("%s is re-pointed by the merge flow", (_m, t) => {
    expect(merge).toContain(`tx.${t.delegate}.updateMany`);
  });
  it("the erasure delete for household consent covers BOTH sides (a delete on the grantee column alone would let a null grantee mean everyone)", () => {
    expect(erasure).toMatch(/householdRelationshipConsent\.deleteMany\(\{ where: \{ OR: \[\{ subjectClientId[^\]]*granteeClientId/);
  });
});
