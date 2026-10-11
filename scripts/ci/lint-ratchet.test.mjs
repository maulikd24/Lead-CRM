import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, summarise } from "./lib/ratchet.mjs";

const base = { total: 3, files: { "a.ts": 2, "b.ts": 1 } };

test("passes at the baseline", () => assert.equal(evaluate(base, { total: 3, files: { "a.ts": 2, "b.ts": 1 } }).ok, true));
test("fails above the baseline", () => {
  const r = evaluate(base, { total: 4, files: { "a.ts": 3, "b.ts": 1 } });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /above the baseline/);
});
test("fails on a new file even when the total is unchanged", () => {
  const r = evaluate(base, { total: 3, files: { "a.ts": 2, "c.ts": 1 } });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /NEW file with errors: c.ts/);
});
test("fails when one file gets worse while another improves", () => {
  const r = evaluate(base, { total: 3, files: { "a.ts": 1, "b.ts": 2 } });
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /b.ts: 1 -> 2/);
});
test("below the baseline asks to lower it", () => {
  const r = evaluate(base, { total: 2, files: { "a.ts": 2 } });
  assert.equal(r.ok, false);
  assert.equal(r.lower, true);
  assert.match(r.problems[0], /lower ci\/lint-baseline.json to 2/);
});
test("summarise keeps only files with errors, relative and sorted", () => {
  const s = summarise([{ filePath: "/r/src/z.ts", errorCount: 1 }, { filePath: "/r/src/a.ts", errorCount: 2 }, { filePath: "/r/src/ok.ts", errorCount: 0 }], "/r");
  assert.deepEqual(s, { total: 3, files: { "src/a.ts": 2, "src/z.ts": 1 } });
});
