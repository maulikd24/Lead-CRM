#!/usr/bin/env node
// One command for everything that does not need a browser: what CI's static, unit, db, migrations and legacy jobs run.
//   npm run ci:check                  full set, in order, stops being quiet about failures but runs every step
//   npm run ci:check -- --fast        skip the database steps (db suites, migrations, legacy)
//   npm run ci:check -- --only lint   run steps whose name contains the text
// Needs a local Postgres for the database steps (CI_PGHOST/CI_PGPORT/CI_PGUSER, default 127.0.0.1:5432, user postgres).
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const fast = argv.includes("--fast");
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

const steps = [
  { name: "prisma generate", cmd: ["npx", "prisma", "generate"] },
  { name: "typegen", cmd: ["npx", "next", "typegen"] },
  { name: "typecheck", cmd: ["npm", "run", "typecheck", "--silent"] },
  { name: "lint ratchet", cmd: ["npm", "run", "ci:lint-ratchet", "--silent"] },
  { name: "ci scripts unit tests", cmd: ["npm", "run", "ci:scripts-test", "--silent"] },
  { name: "ai gateway boundary", cmd: ["node", "scripts/ci/ai-boundary.mjs"] },
  { name: "migration order", cmd: ["npm", "run", "ci:migration-order", "--silent"] },
  { name: "db suite registry", cmd: ["npm", "run", "ci:db-suites", "--silent", "--", "--check"] },
  { name: "unit tests", cmd: ["npm", "test", "--silent"] },
  { name: "migrations", cmd: ["npm", "run", "ci:migrations", "--silent"], db: true },
  { name: "legacy upgrade", cmd: ["npm", "run", "ci:legacy", "--silent"], db: true },
  { name: "db suites", cmd: ["npm", "run", "ci:db-suites", "--silent"], db: true },
].filter((s) => (!fast || !s.db) && (!only || s.name.includes(only)));

const rows = [];
for (const s of steps) {
  const t0 = Date.now();
  console.log(`\n=== ${s.name} ===`);
  const r = spawnSync(s.cmd[0], s.cmd.slice(1), { stdio: "inherit", env: process.env });
  rows.push({ name: s.name, ok: r.status === 0, s: (Date.now() - t0) / 1000 });
}
console.log("\n=== ci:check summary ===");
for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(24)} ${r.s.toFixed(1)}s`);
const bad = rows.filter((r) => !r.ok);
console.log(`ci:check: ${bad.length ? `FAIL (${bad.map((b) => b.name).join(", ")})` : "PASS"}`);
process.exit(bad.length ? 1 : 0);
