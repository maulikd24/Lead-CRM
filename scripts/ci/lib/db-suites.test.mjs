import test from "node:test";
import assert from "node:assert/strict";
import { checkCoverage, switchesIn } from "./db-suites.mjs";

test("a db test file that no registry row covers is reported", () => {
  const p = checkCoverage(["a.db.test.ts", "b.db.test.ts"], [{ file: "a.db.test.ts", switch: "A_DB_TEST" }]);
  assert.equal(p.length, 1);
  assert.match(p[0], /b\.db\.test\.ts exists but is not in ci\/db-suites\.json/);
});
test("a registry row without a file is reported", () => assert.match(checkCoverage([], [{ file: "gone.db.test.ts" }])[0], /does not exist/));
test("a full match is clean", () => assert.deepEqual(checkCoverage(["a.db.test.ts"], [{ file: "a.db.test.ts" }]), []));
test("duplicates are reported", () => assert.match(checkCoverage(["a"], [{ file: "a" }, { file: "a" }]).join(), /listed twice/));
test("switchesIn finds the switch names a suite mentions", () => {
  assert.deepEqual(switchesIn('const e = process.env.X_DB_TEST === "1" && process.env.X_DB_TEST'), ["X_DB_TEST"]);
  assert.deepEqual(switchesIn('enabledWhen("PARTNER_NATIVE_DB_TEST")'), ["PARTNER_NATIVE_DB_TEST"]);
});
