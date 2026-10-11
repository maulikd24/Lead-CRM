// Shared helpers for the CI scripts: local-only Postgres access, scratch database names, and prisma runs against
// a chosen migrations folder. Nothing here can touch a database whose name does not start with CI_DB_PREFIX.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "package.json"));
const pg = require("pg");

export const HOST = process.env.CI_PGHOST || process.env.PGHOST || "127.0.0.1";
export const PORT = Number(process.env.CI_PGPORT || process.env.PGPORT || 5432);
export const USER = process.env.CI_PGUSER || process.env.PGUSER || "postgres";
/** Every scratch database starts with this (local runs: wt_ci_). The CI service container has nothing else in it. */
export const PREFIX = process.env.CI_DB_PREFIX || "wt_ci_";

if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) {
  console.error(`REFUSED: Postgres host '${HOST}' is not a local address.`);
  process.exit(2);
}

export function assertScratch(name) {
  if (!name.startsWith(PREFIX) || !/^[a-z0-9_]{1,60}$/.test(name)) {
    console.error(`REFUSED: database '${name}' must start with '${PREFIX}' and use only a-z, 0-9 and _.`);
    process.exit(2);
  }
  return name;
}

export const urlFor = (db) => `postgresql://${USER}@${HOST}:${PORT}/${db}`;

export async function client(db = "postgres") {
  const c = new pg.Client({ host: HOST, port: PORT, user: USER, database: db });
  await c.connect();
  return c;
}

export async function dropDb(name) {
  assertScratch(name);
  const c = await client();
  try { await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await c.end(); }
}

export async function createDb(name, template) {
  assertScratch(name);
  await dropDb(name);
  const c = await client();
  try { await c.query(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${assertScratch(template)}"` : ""}`); } finally { await c.end(); }
}

export async function scalar(db, sql) {
  const c = await client(db);
  try { const r = await c.query(sql); return r.rows[0] ? Object.values(r.rows[0])[0] : undefined; } finally { await c.end(); }
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts, env: { ...process.env, LC_ALL: process.env.LC_ALL || "en_US.UTF-8", ...(opts.env ?? {}) } });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const PRISMA = path.join(process.cwd(), "node_modules/.bin/prisma");

/** Run `prisma <args>` against `db` with a throw-away config pointing at the given schema and migrations folder. */
export function prisma(args, db, { schema = path.join(process.cwd(), "prisma/schema.prisma"), migrations = path.join(process.cwd(), "prisma/migrations") } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ci-prisma-"));
  const cfg = path.join(dir, "prisma.config.mjs");
  writeFileSync(cfg, `export default { schema: ${JSON.stringify(schema)}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } };\n`);
  try { return run(PRISMA, [...args, "--config", cfg], { env: { DATABASE_URL: urlFor(db) }, cwd: process.cwd() }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

export function psql(db, args, opts = {}) {
  return run("psql", ["-X", "-q", "-h", HOST, "-p", String(PORT), "-U", USER, "-d", db, "-v", "ON_ERROR_STOP=1", ...args], opts);
}

export function pgDumpSchema(db) {
  const r = run("pg_dump", ["-s", "--no-owner", "--no-privileges", "-h", HOST, "-p", String(PORT), "-U", USER, db]);
  if (r.status !== 0) throw new Error(`pg_dump failed: ${r.stderr.slice(0, 500)}`);
  // drop the lines that legitimately differ between dumps
  return r.stdout.split("\n").filter((l) => !/^(--|SET |SELECT pg_catalog|\\restrict|\\unrestrict)/.test(l)).join("\n");
}

export function git(args, opts = {}) { return run("git", args, opts); }
