#!/usr/bin/env node
// Lint ratchet: fails on any NEW eslint error (see docs/ci.md, "Lint baseline ratchet").
//   node scripts/ci/lint-ratchet.mjs                  run eslint src --quiet and compare with ci/lint-baseline.json
//   node scripts/ci/lint-ratchet.mjs --input f.json   compare an existing `eslint -f json` output instead of running eslint
//   node scripts/ci/lint-ratchet.mjs --update         lower the baseline to the current numbers (refuses to raise it)
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluate, summarise } from "./lib/ratchet.mjs";

const root = process.cwd();
const baselinePath = path.join(root, "ci/lint-baseline.json");
const args = process.argv.slice(2);
const inputIdx = args.indexOf("--input");

let json;
if (inputIdx >= 0) json = JSON.parse(readFileSync(args[inputIdx + 1], "utf8"));
else {
  const r = spawnSync("npx", ["eslint", "src", "--quiet", "-f", "json"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  try { json = JSON.parse(r.stdout); } catch { console.error(`lint ratchet: eslint produced no JSON (exit ${r.status})\n${(r.stderr || "").slice(0, 2000)}`); process.exit(2); }
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const current = summarise(json, root);

if (args.includes("--update")) {
  if (current.total > baseline.total || evaluate(baseline, current).problems.some((p) => p.startsWith("NEW") || p.startsWith("more errors"))) {
    console.error("lint ratchet: refusing to raise the baseline. Fix the new errors instead.");
    process.exit(1);
  }
  writeFileSync(baselinePath, JSON.stringify({ _comment: baseline._comment, ...current }, null, 2) + "\n");
  console.log(`lint ratchet: baseline lowered ${baseline.total} -> ${current.total}`);
  process.exit(0);
}

const res = evaluate(baseline, current);
if (res.ok) console.log(`lint ratchet: PASS (${current.total} errors in ${Object.keys(current.files).length} files; baseline ${baseline.total})`);
else {
  console.error(`lint ratchet: FAIL (${current.total} errors; baseline ${baseline.total})`);
  for (const p of res.problems) console.error(`  - ${p}`);
}
process.exit(res.ok ? 0 : 1);
