#!/usr/bin/env node
// Real-database suites (gate G7): each *.db.test.ts file runs on its OWN database, cloned from one freshly migrated
// template, with its env switch set. No suite sees another's rows.
//   node scripts/ci/db-suites.mjs                 run every suite that is not nightly-only
//   node scripts/ci/db-suites.mjs --nightly       include the nightly-only suites (perf)
//   node scripts/ci/db-suites.mjs --only <text>   only suites whose file path contains <text>
//   node scripts/ci/db-suites.mjs --check         only verify that every *.db.test.ts file is registered
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PREFIX, createDb, dropDb, prisma, run, urlFor } from "./lib/db.mjs";
import { checkCoverage, switchesIn } from "./lib/db-suites.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const registry = JSON.parse(readFileSync(path.join(root, "ci/db-suites.json"), "utf8")).suites;
const files = run("git", ["ls-files", "*.db.test.ts"], { cwd: root }).stdout.split("\n").filter(Boolean);

const problems = checkCoverage(files, registry);
for (const s of registry) {
  if (!files.includes(s.file)) continue;
  const used = switchesIn(readFileSync(path.join(root, s.file), "utf8"));
  if (!used.includes(s.switch)) problems.push(`${s.file}: registry says ${s.switch} but the file reads ${used.join(", ") || "no switch"}`);
}
if (problems.length) { for (const p of problems) console.error(`  - ${p}`); console.error("db suites: FAIL (registry out of date)"); process.exit(1); }
console.log(`db suites: ${files.length} *.db.test.ts files, all registered`);
if (args.includes("--check")) process.exit(0);

const TPL = `${PREFIX}tpl`;
const todo = registry.filter((s) => (args.includes("--nightly") || !s.nightlyOnly) && (!only || s.file.includes(only)));
const out = mkdtempSync(path.join(os.tmpdir(), "ci-dbs-"));
const results = [];
try {
  await createDb(TPL);
  const m = prisma(["migrate", "deploy"], TPL);
  if (m.status !== 0) { console.error(`template migrate failed:\n${(m.stderr || m.stdout).slice(-1500)}`); process.exit(1); }
  // The documented scratch-database recipe is migrate + seed: several suites expect the baseline stages the seed creates.
  const sd = run("npx", ["tsx", "prisma/seed.ts"], { cwd: root, env: { DATABASE_URL: urlFor(TPL) } });
  if (sd.status !== 0) { console.error(`template seed failed:\n${(sd.stderr || sd.stdout).slice(-1500)}`); process.exit(1); }
  for (const [i, s] of todo.entries()) {
    const db = `${PREFIX}s${i}`;
    await createDb(db, TPL);
    const t0 = Date.now();
    const json = path.join(out, `${i}.json`);
    const r = run("npx", ["vitest", "run", s.file, "--reporter=json", `--outputFile=${json}`], { cwd: root, env: { DATABASE_URL: urlFor(db), [s.switch]: "1", ...(s.switch === "PARTNER_PERF_DB_TEST" ? { PARTNER_PERF_SCALE: process.env.PARTNER_PERF_SCALE ?? "1" } : {}) } });
    let passed = 0, skipped = 0, failed = 0;
    try { const j = JSON.parse(readFileSync(json, "utf8")); passed = j.numPassedTests; skipped = j.numPendingTests; failed = j.numFailedTests; } catch { failed = 1; }
    // a suite that ran zero tests passed nothing: its switch or database guard did not take effect
    const ok = r.status === 0 && failed === 0 && passed > 0;
    results.push({ file: s.file, ok, passed, skipped, failed, s: (Date.now() - t0) / 1000 });
    console.log(`${ok ? "PASS" : "FAIL"}  ${s.file}  ${passed} passed, ${skipped} skipped, ${failed} failed  ${((Date.now() - t0) / 1000).toFixed(1)}s${ok ? "" : `\n${(r.stdout + r.stderr).slice(-1500)}`}`);
    await dropDb(db);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
  await dropDb(TPL);
}
const bad = results.filter((r) => !r.ok);
console.log(`\ndb suites: ${bad.length ? "FAIL" : "PASS"} (${results.length - bad.length}/${results.length} files, ${results.reduce((a, r) => a + r.passed, 0)} tests, ${results.reduce((a, r) => a + r.s, 0).toFixed(1)}s)`);
process.exit(bad.length ? 1 : 0);
