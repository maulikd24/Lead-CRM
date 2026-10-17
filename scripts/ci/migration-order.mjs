#!/usr/bin/env node
// Migration order and additive-only lint. No database needed. Prints PASS or FAIL and exits 0 / 1.
//   node scripts/ci/migration-order.mjs [--no-history]    --no-history skips the git introduction-order check
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { baselineRef, migrationNamesAt } from "./lib/baseline.mjs";
import { git } from "./lib/db.mjs";
import { checkIntroductionOrder, checkNoRenames, lintMigrations, normalise } from "./lib/migration-lint.mjs";

const root = process.cwd();
const dir = path.join(root, "prisma/migrations");
const migrations = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ name: d.name, sql: readFileSync(path.join(dir, d.name, "migration.sql"), "utf8") }));

const onDisk = new Set(migrations.map((m) => m.name));
const allow = new Set(readFileSync(path.join(root, "ci/known-drift.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map(normalise));
const baseline = new Set(migrationNamesAt(baselineRef()));
const { problems } = lintMigrations(migrations, { baseline, allow });

if (!process.argv.includes("--no-history")) {
  const base = readFileSync(path.join(root, "ci/migration-order-base.txt"), "utf8").split("\n").find((l) => l && !l.startsWith("#")).trim();
  // -m with --first-parent: a merge commit lists what it added relative to its first parent, so each train merge is one group.
  const r = git(["log", "--first-parent", "-m", "--reverse", "--diff-filter=A", "--name-only", "--format=%x00%h", `${base}..HEAD`, "--", "prisma/migrations"]);
  if (r.status !== 0) { console.error(`migration order: git log failed (is ${base} in the clone? use fetch-depth: 0)\n${r.stderr}`); process.exit(2); }
  const groups = r.stdout.split("\0").map((chunk) => chunk.split("\n").slice(1).map((l) => /^prisma\/migrations\/([^/]+)\/migration\.sql$/.exec(l.trim())?.[1]).filter((n) => n && onDisk.has(n))).filter((g) => g.length); // a folder renamed or removed since is judged by its current name
  problems.push(...checkIntroductionOrder(groups));
}

// Never rename or remove a migration that is already on the base branch (it may have run in Production). The base is the
// pull request's target branch in CI, the previous commit on a push, and origin/main locally; skipped if it isn't in the clone.
const renameBase = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : process.env.GITHUB_EVENT_NAME === "push" ? "HEAD^1" : "origin/main";
const baseTree = git(["ls-tree", "--name-only", renameBase, "prisma/migrations/"]);
if (baseTree.status === 0) {
  const namesOnBase = baseTree.stdout.split("\n").filter((l) => l && !l.endsWith("migration_lock.toml")).map((l) => path.basename(l));
  problems.push(...checkNoRenames(namesOnBase, [...onDisk]));
} else {
  console.warn(`migration order: rename check skipped (${renameBase} not in the clone)`);
}

const fresh = migrations.filter((m) => !baseline.has(m.name)).length;
console.log(`migration order: ${migrations.length} migrations (${baseline.size} upstream, ${fresh} added by the train)`);
if (problems.length === 0) { console.log("migration order: PASS"); process.exit(0); }
for (const p of problems) console.error(`  [${p.kind}] ${p.migration}: ${p.detail}`);
console.error(`migration order: FAIL (${problems.length} problem${problems.length === 1 ? "" : "s"})`);
process.exit(1);
