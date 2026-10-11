import test from "node:test";
import assert from "node:assert/strict";
import { checkIntroductionOrder, lintMigrations, normalise, splitStatements } from "./migration-lint.mjs";

const m = (name, sql) => ({ name, sql });
const run = (list, opts = {}) => lintMigrations(list, { baseline: new Set(), allow: new Set(), ...opts });
const kinds = (r) => r.problems.map((p) => p.kind);

test("splitStatements ignores comments, strings and dollar-quoted bodies", () => {
  const s = splitStatements(`-- a; b\nCREATE TABLE "T" (x TEXT DEFAULT 'a;b');\n/* c; */ DO $$ BEGIN UPDATE "X" SET a=1; END $$;`);
  assert.equal(s.length, 2);
  assert.match(s[0], /^CREATE TABLE "T"/);
  assert.match(s[1], /^DO \$\$/);
});

test("a clean additive migration passes", () => {
  const r = run([m("20270101000000_a", `CREATE TABLE "T" ("id" TEXT NOT NULL);\nCREATE INDEX "T_id_idx" ON "T"("id");\nALTER TABLE "User" ADD COLUMN "x" TEXT;\nALTER TABLE "User" ADD COLUMN "y" INTEGER NOT NULL DEFAULT 0;`)]);
  assert.deepEqual(r.problems, []);
});

test("rejects a duplicate timestamp", () => {
  assert.ok(kinds(run([m("20270101000000_a", "SELECT 1;"), m("20270101000000_b", "SELECT 1;")])).includes("duplicate-timestamp"));
});

test("rejects a bad folder name", () => assert.ok(kinds(run([m("add_thing", "SELECT 1;")])).includes("bad-name")));

test("rejects the same enum value added twice (two migrations adding the same Role value)", () => {
  const r = run([m("20270401000000_a", `ALTER TYPE "Role" ADD VALUE 'MARKETING';`), m("20270630000000_b", `ALTER TYPE "Role" ADD VALUE 'MARKETING';`)]);
  assert.deepEqual(kinds(r), ["duplicate-enum-value"]);
  assert.match(r.problems[0].detail, /Role.*MARKETING/);
});

test("a later IF NOT EXISTS duplicate is harmless", () => {
  const r = run([m("20270401000000_a", `ALTER TYPE "Role" ADD VALUE 'MARKETING';`), m("20270630000000_b", `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MARKETING';`)]);
  assert.deepEqual(r.problems, []);
});

test("different values and different types are fine", () => {
  const r = run([m("20270401000000_a", `ALTER TYPE "Role" ADD VALUE 'MARKETING';`), m("20270402000000_b", `ALTER TYPE "Role" ADD VALUE 'OTHER'; ALTER TYPE "Kind" ADD VALUE 'MARKETING';`)]);
  assert.deepEqual(r.problems, []);
});

test("rejects non-additive statements in new migrations", () => {
  const cases = [
    `DROP TABLE "X";`, `ALTER TABLE "X" DROP COLUMN "a";`, `ALTER TABLE "X" ALTER COLUMN "a" SET NOT NULL;`, `ALTER TABLE "X" RENAME COLUMN "a" TO "b";`,
    `ALTER TABLE "X" RENAME TO "Y";`, `TRUNCATE "X";`, `DELETE FROM "X";`, `UPDATE "X" SET a = 1;`, `ALTER TABLE "X" ADD COLUMN "a" TEXT NOT NULL;`, `DROP INDEX "i";`,
    `ALTER TABLE "X" DROP CONSTRAINT "c";`,
  ];
  for (const sql of cases) assert.ok(kinds(run([m("20270101000000_a", sql)])).includes("non-additive"), sql);
});

test("baseline (already shared upstream) migrations are exempt from the additive rule but not from the enum rule", () => {
  const baseline = new Set(["20260101000000_old"]);
  const r = run([m("20260101000000_old", `DROP TABLE "X"; ALTER TYPE "Role" ADD VALUE 'A';`), m("20270101000000_new", `ALTER TYPE "Role" ADD VALUE 'A';`)], { baseline });
  assert.deepEqual(kinds(r), ["duplicate-enum-value"]);
});

test("the known drift statements are allowed (normalised comparison)", () => {
  const stmt = `ALTER TABLE "Document" DROP CONSTRAINT "Document_holderId_fkey";`;
  const allow = new Set([normalise(stmt)]);
  assert.deepEqual(run([m("20270101000000_a", `-- DropForeignKey\nALTER   TABLE "Document"\n  DROP CONSTRAINT "Document_holderId_fkey";`)], { allow }).problems, []);
  assert.ok(kinds(run([m("20270101000000_a", stmt)])).includes("non-additive"));
});

test("a new migration must sort after the last baseline migration", () => {
  const baseline = new Set(["20261023000000_old"]);
  const r = run([m("20261023000000_old", "SELECT 1;"), m("20261001000000_late", "SELECT 1;")], { baseline });
  assert.ok(kinds(r).includes("before-baseline"));
});

test("introduction order: a migration introduced later must not sort before an earlier one", () => {
  const ok = checkIntroductionOrder([["20270401000000_a"], ["20270405000000_b"]]);
  assert.deepEqual(ok, []);
  const bad = checkIntroductionOrder([["20270401000000_a"], ["20270150000000_b"]]);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].kind, "out-of-order");
  assert.match(bad[0].detail, /20270150000000_b.*20270401000000_a/);
});

test("migrations introduced together may be in any order among themselves", () => {
  assert.deepEqual(checkIntroductionOrder([["20270402000000_b", "20270401000000_a"]]), []);
});
