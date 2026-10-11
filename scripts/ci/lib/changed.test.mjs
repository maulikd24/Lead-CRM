import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "./changed.mjs";

test("a docs-only change needs no code jobs", () => assert.deepEqual(classify(["docs/ci.md", "README.md"]), { code: false, db: false, ui: false, layout: false }));
test("a migration needs the database and ui jobs", () => {
  const r = classify(["prisma/migrations/20270901000000_x/migration.sql"]);
  assert.equal(r.db, true);
  assert.equal(r.ui, true);
});
test("a component change needs ui and layout but not the database jobs", () => {
  const r = classify(["src/components/app-sidebar.tsx"]);
  assert.deepEqual(r, { code: true, db: false, ui: true, layout: true });
});
test("a lib change needs the database jobs", () => assert.equal(classify(["src/lib/referrals/store.ts"]).db, true));
test("an android-only change is not code", () => assert.equal(classify(["android-app/app/build.gradle"]).code, false));
