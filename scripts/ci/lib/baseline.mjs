// Reads the pinned upstream baseline (scripts/ci/legacy-db/baseline.txt) and the migration folders at that commit.
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { git, run } from "./db.mjs";

export function baselineRef() {
  const f = path.join(process.cwd(), "scripts/ci/legacy-db/baseline.txt");
  return readFileSync(f, "utf8").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
}

export function assertCommit(ref) {
  const r = git(["cat-file", "-t", `${ref}^{commit}`]);
  if (r.status !== 0) {
    console.error(`Cannot find commit ${ref}. In CI use actions/checkout with fetch-depth: 0 (the pinned upstream baseline must be in the clone).`);
    process.exit(2);
  }
}

/** Folder names of the migrations that exist at `ref`. */
export function migrationNamesAt(ref) {
  assertCommit(ref);
  const r = git(["ls-tree", "--name-only", ref, "prisma/migrations/"]);
  return r.stdout.split("\n").filter((l) => l && !l.endsWith("migration_lock.toml")).map((l) => path.basename(l));
}

/** Extract prisma/migrations and prisma/schema.prisma at `ref` into `dir` (a clean, empty directory). */
export function exportBaseline(ref, dir) {
  assertCommit(ref);
  mkdirSync(dir, { recursive: true });
  const r = run("sh", ["-c", `git archive ${JSON.stringify(ref)} prisma/migrations prisma/schema.prisma | tar -x -C ${JSON.stringify(dir)}`]);
  if (r.status !== 0) { console.error(`git archive failed: ${r.stderr}`); process.exit(2); }
  return { schema: path.join(dir, "prisma/schema.prisma"), migrations: path.join(dir, "prisma/migrations"), count: readdirSync(path.join(dir, "prisma/migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).length };
}
