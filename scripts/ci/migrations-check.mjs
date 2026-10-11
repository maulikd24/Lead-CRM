#!/usr/bin/env node
// Migration check (gates G5 and G13). Prints PASS or FAIL per step and exits non-zero on any failure.
//   1. static lint: order, duplicate enum values, additive-only          (scripts/ci/migration-order.mjs, no database)
//   2. migrate deploy FROM EMPTY; applied count == folders; `migrate diff` against schema.prisma shows only the known drift
//   3. migrate deploy ON TOP of upstream main's migrations (the pinned baseline); the resulting schema equals step 2's
// Scratch databases: <prefix>mig_empty and <prefix>mig_top, dropped at the end (set CI_KEEP_DB=1 to keep them).
import { readdirSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { baselineRef, exportBaseline } from "./lib/baseline.mjs";
import { PREFIX, createDb, dropDb, pgDumpSchema, prisma, run, scalar } from "./lib/db.mjs";
import { normalise, splitStatements } from "./lib/migration-lint.mjs";

const root = process.cwd();
const folders = readdirSync(path.join(root, "prisma/migrations"), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
const known = new Set(readFileSync(path.join(root, "ci/known-drift.txt"), "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map(normalise));
const results = [];
const step = async (title, fn) => {
  const t0 = Date.now();
  let r;
  try { r = (await fn()) ?? {}; } catch (e) { r = { ok: false, detail: String(e?.message ?? e) }; }
  results.push({ title, ok: r.ok !== false, detail: r.detail ?? "", s: (Date.now() - t0) / 1000 });
  console.log(`${r.ok === false ? "FAIL" : "PASS"}  ${title} (${((Date.now() - t0) / 1000).toFixed(1)}s)${r.detail ? `\n      ${r.detail.split("\n").join("\n      ")}` : ""}`);
  return r;
};

const EMPTY = `${PREFIX}mig_empty`;
const TOP = `${PREFIX}mig_top`;
const tmp = mkdtempSync(path.join(os.tmpdir(), "ci-mig-"));
let emptyDump = "";

try {
  await step("static lint: order, duplicate enum values, additive only", () => {
    const r = run("node", [path.join(root, "scripts/ci/migration-order.mjs")], { cwd: root });
    return { ok: r.status === 0, detail: r.status === 0 ? "" : (r.stderr || r.stdout).trim() };
  });

  await step(`migrate deploy from empty (${folders} migrations)`, async () => {
    await createDb(EMPTY);
    const r = prisma(["migrate", "deploy"], EMPTY);
    if (r.status !== 0) return { ok: false, detail: (r.stderr || r.stdout).slice(-1500) };
    const n = Number(await scalar(EMPTY, `select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null`));
    if (n !== folders) return { ok: false, detail: `applied ${n}, but ${folders} folders exist` };
    emptyDump = pgDumpSchema(EMPTY);
  });

  await step("schema.prisma matches the migrations (only the known drift, ci/known-drift.txt)", () => {
    const r = prisma(["migrate", "diff", "--from-config-datasource", "--to-schema", path.join(root, "prisma/schema.prisma"), "--script"], EMPTY);
    if (r.status !== 0) return { ok: false, detail: (r.stderr || r.stdout).slice(-1500) };
    const got = splitStatements(r.stdout).map(normalise);
    const unknown = got.filter((s) => !known.has(s));
    const gone = [...known].filter((s) => !got.includes(s));
    if (unknown.length) return { ok: false, detail: `${unknown.length} schema/migration difference(s) not in the known drift (add a migration, or fix schema.prisma):\n${unknown.map((s) => `- ${s.slice(0, 200)}`).join("\n")}` };
    return { detail: `${got.length} known drift statements${gone.length ? `; ${gone.length} known ones no longer appear: remove them from ci/known-drift.txt` : ""}` };
  });

  const ref = baselineRef();
  await step(`migrate deploy on top of upstream main's migrations (baseline ${ref})`, async () => {
    const base = exportBaseline(ref, path.join(tmp, "baseline"));
    await createDb(TOP);
    const a = prisma(["migrate", "deploy"], TOP, { schema: base.schema, migrations: base.migrations });
    if (a.status !== 0) return { ok: false, detail: `baseline apply failed: ${(a.stderr || a.stdout).slice(-1200)}` };
    const b = prisma(["migrate", "deploy"], TOP);
    if (b.status !== 0) return { ok: false, detail: `train migrations on top failed: ${(b.stderr || b.stdout).slice(-1500)}` };
    const n = Number(await scalar(TOP, `select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null`));
    if (n !== folders) return { ok: false, detail: `applied ${n}, but ${folders} folders exist` };
    const dump = pgDumpSchema(TOP);
    if (dump !== emptyDump) {
      const a1 = new Set(emptyDump.split("\n")), b1 = new Set(dump.split("\n"));
      const diff = [...a1].filter((l) => !b1.has(l)).slice(0, 5).map((l) => `only from-empty: ${l}`).concat([...b1].filter((l) => !a1.has(l)).slice(0, 5).map((l) => `only on-top: ${l}`));
      return { ok: false, detail: `schema after on-top differs from schema from empty:\n${diff.join("\n")}` };
    }
    return { detail: `${base.count} upstream + ${folders - base.count} train migrations; schema identical to from-empty` };
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
  if (process.env.CI_KEEP_DB !== "1") { await dropDb(EMPTY); await dropDb(TOP); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\nmigrations check: ${failed.length ? "FAIL" : "PASS"} (${results.length - failed.length}/${results.length} steps, ${results.reduce((a, r) => a + r.s, 0).toFixed(1)}s)`);
process.exit(failed.length ? 1 : 0);
