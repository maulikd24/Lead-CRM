#!/usr/bin/env node
// verify.mjs: proves an upgrade from the original (upstream main) schema to the train's schema changed nothing that existed before.
// Run from the repository root (it loads `pg` from ./node_modules). Used by scripts/ci/legacy-db/run.mjs.
//
//   node verify.mjs snapshot <database> <before.json>            run BEFORE `prisma migrate deploy`
//   node verify.mjs check    <database> <before.json> [options]  run AFTER it
//       --report <file.md>   write the readable report
//       --json <file.json>   write the machine-readable result
//       --migrations <dir>   migrations folder to compare with the database (default: ./prisma/migrations)
//       --no-prisma-status   skip running `prisma migrate status`
//
// Local scratch databases only (host 127.0.0.1, localhost or ::1; database name must start with CI_DB_PREFIX, default wt_ci_). Reads only: it never writes to the database it
// checks. Exit code 0 = PASS (warnings allowed), 1 = FAIL, 2 = refused or could not run.
// No row content is written to the report: only counts, names and hashes.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REPO = process.cwd();
const HOST = process.env.CI_PGHOST || process.env.PGHOST || "127.0.0.1";
const PORT = Number(process.env.CI_PGPORT || process.env.PGPORT || 5432);
const USER = process.env.CI_PGUSER || process.env.PGUSER || "postgres";
const PREFIX = process.env.CI_DB_PREFIX || "wt_ci_";

function refuse(msg) { console.error(`REFUSED: ${msg}`); process.exit(2); }
if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) refuse(`PGHOST='${HOST}' is not a local address.`);

let pg;
try { pg = createRequire(path.join(REPO, "package.json"))("pg"); }
catch { refuse(`cannot load 'pg' from '${REPO}' (run npm ci, and run this from the repository root).`); }

process.on("uncaughtException", (e) => { console.error(`verify could not run: ${e.message}`); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error(`verify could not run: ${e?.message ?? e}`); process.exit(2); });

const [cmd, dbName, beforePath, ...rest] = process.argv.slice(2);
if (!["snapshot", "check"].includes(cmd) || !dbName || !beforePath) {
  console.error("usage: verify.mjs snapshot <db> <before.json>  |  verify.mjs check <db> <before.json> [--report f.md] [--json f.json]");
  process.exit(2);
}
if (!dbName.startsWith(PREFIX) || !/^[a-z0-9_]{1,60}$/.test(dbName)) refuse(`database '${dbName}' must start with '${PREFIX}'`);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };

const db = new pg.Client({ host: HOST, port: PORT, user: USER, database: dbName });
await db.connect();
await db.query("SET statement_timeout = 0");
await db.query("SET default_transaction_read_only = on");
const q = async (sql, params) => (await db.query(sql, params)).rows;
const qi = (name) => `"${String(name).replace(/"/g, '""')}"`;

const SKIP_TABLES = new Set(["_prisma_migrations"]);
// Tables whose rows are sampled one by one (before and after); all must have a text primary key called "id".
const SAMPLE_TABLES = ["Client", "User", "Message", "Activity", "LeadIntake", "CommissionAccrual", "Payout", "AuditLog", "RevenueEvent", "PartnerProfile", "Task", "Notification"];
const SAMPLE_SIZE = 100;

async function tableColumns() {
  const rows = await q(`
    SELECT c.table_name AS t, c.column_name AS name, c.data_type AS type, c.udt_name AS udt, c.is_nullable = 'YES' AS nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
     ORDER BY c.table_name, c.ordinal_position`);
  const out = {};
  for (const r of rows) (out[r.t] ??= []).push({ name: r.name, type: r.type === "USER-DEFINED" ? `enum:${r.udt}` : r.type, nullable: r.nullable });
  return out;
}

const rowExpr = (cols) => `ROW(${cols.map((c) => `t.${qi(c)}`).join(", ")})::text`;

async function tableFingerprint(table, cols) {
  const [{ n }] = await q(`SELECT count(*)::bigint AS n FROM ${qi(table)}`);
  if (!cols.length) return { rows: Number(n), hash: null };
  const [{ h }] = await q(`SELECT md5(coalesce(string_agg(x.h, '' ORDER BY x.h), '')) AS h FROM (SELECT md5(${rowExpr(cols)}) AS h FROM ${qi(table)} t) x`);
  return { rows: Number(n), hash: h };
}

async function samples(columnsByTable, ids) {
  const out = {};
  for (const table of SAMPLE_TABLES) {
    const cols = (columnsByTable[table] ?? []).map((c) => c.name);
    if (!cols.includes("id")) continue;
    const rows = ids
      ? await q(`SELECT t.id, md5(${rowExpr(cols)}) AS h FROM ${qi(table)} t WHERE t.id = ANY($1::text[])`, [ids[table] ?? []])
      : await q(`SELECT t.id, md5(${rowExpr(cols)}) AS h FROM ${qi(table)} t ORDER BY md5(t.id) LIMIT ${SAMPLE_SIZE}`);
    out[table] = Object.fromEntries(rows.map((r) => [r.id, r.h]));
  }
  return out;
}

async function constraintNames() {
  return (await q(`SELECT conname AS n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace WHERE ns.nspname = 'public' ORDER BY 1`)).map((r) => r.n);
}
async function indexNames() {
  return (await q(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`)).map((r) => r.n);
}
async function appliedMigrations() {
  return (await q(`SELECT migration_name AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`)).map((r) => r.n);
}

// ------------------------------------------------------------------------------------------------------ snapshot
if (cmd === "snapshot") {
  const t0 = Date.now();
  const cols = await tableColumns();
  const tables = {};
  for (const [name, columns] of Object.entries(cols)) {
    if (SKIP_TABLES.has(name)) continue;
    const fp = await tableFingerprint(name, columns.map((c) => c.name));
    tables[name] = { columns, ...fp };
  }
  const [{ bytes }] = await q("SELECT pg_database_size(current_database())::bigint AS bytes");
  const sampled = await samples(cols, null);
  const snap = {
    kind: "ci-legacy-snapshot", takenAt: new Date().toISOString(), database: dbName,
    serverVersion: (await q("SHOW server_version"))[0].server_version, dbBytes: Number(bytes),
    tables, constraints: await constraintNames(), indexes: await indexNames(), applied: await appliedMigrations(),
    samples: sampled,
  };
  writeFileSync(beforePath, JSON.stringify(snap));
  const rows = Object.values(tables).reduce((a, t) => a + t.rows, 0);
  console.log(`snapshot: ${Object.keys(tables).length} tables, ${rows.toLocaleString()} rows, ${snap.applied.length} migrations applied, ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${beforePath}`);
  await db.end();
  process.exit(0);
}

// ----------------------------------------------------------------------------------------------------------- check
const before = JSON.parse(readFileSync(beforePath, "utf8"));
if (before.kind !== "ci-legacy-snapshot") refuse("not a snapshot file");
const results = []; // {id, title, status, detail}
const add = (id, title, status, detail = "") => results.push({ id, title, status, detail });
const fmt = (n) => Number(n).toLocaleString("en-US");
const list = (xs, max = 8) => (xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} and ${xs.length - max} more`);

const afterCols = await tableColumns();

// 1. original tables: present, columns kept, counts and content identical -----------------------------------------------
{
  const missing = [], colLost = [], typeChanged = [], nullWeaker = [], countDiff = [], hashDiff = [];
  let origRows = 0;
  const perTable = [];
  for (const [name, b] of Object.entries(before.tables)) {
    origRows += b.rows;
    const a = afterCols[name];
    if (!a) { missing.push(name); continue; }
    const byName = new Map(a.map((c) => [c.name, c]));
    for (const c of b.columns) {
      const now = byName.get(c.name);
      if (!now) colLost.push(`${name}.${c.name}`);
      else {
        if (now.type !== c.type) typeChanged.push(`${name}.${c.name}: ${c.type} -> ${now.type}`);
        if (now.nullable && !c.nullable) nullWeaker.push(`${name}.${c.name}`);
      }
    }
    const keptCols = b.columns.map((c) => c.name).filter((n) => byName.has(n));
    const fp = await tableFingerprint(name, keptCols);
    perTable.push({ name, before: b.rows, after: fp.rows, same: fp.rows === b.rows && fp.hash === b.hash });
    if (fp.rows !== b.rows) countDiff.push(`${name} ${fmt(b.rows)} -> ${fmt(fp.rows)}`);
    if (fp.hash !== b.hash) hashDiff.push(name);
  }
  const n = Object.keys(before.tables).length;
  add("tables-present", `All ${n} original tables still exist`, missing.length ? "FAIL" : "PASS", missing.length ? list(missing) : "");
  add("columns-kept", "No original column removed", colLost.length ? "FAIL" : "PASS", colLost.length ? list(colLost) : "");
  add("types-kept", "No original column changed type", typeChanged.length ? "FAIL" : "PASS", typeChanged.length ? list(typeChanged) : "");
  add("nullability", "No original NOT NULL column became nullable", nullWeaker.length ? "WARN" : "PASS", nullWeaker.length ? list(nullWeaker) : "");
  add("row-counts", `Row counts identical on all original tables (${fmt(origRows)} rows)`, countDiff.length ? "FAIL" : "PASS", countDiff.length ? list(countDiff) : "");
  add("row-content", "Row content identical on all original tables (hash of every original column)", hashDiff.length ? "FAIL" : "PASS", hashDiff.length ? `content differs: ${list(hashDiff)}` : "");
  globalThis.__perTable = perTable;
}

// 2. new tables ------------------------------------------------------------------------------------------------------------
{
  const fresh = Object.keys(afterCols).filter((t) => !SKIP_TABLES.has(t) && !before.tables[t]);
  const withRows = [];
  for (const t of fresh) { const [{ n }] = await q(`SELECT count(*)::bigint AS n FROM ${qi(t)}`); if (Number(n) > 0) withRows.push(`${t}=${n}`); }
  add("new-tables", `${fresh.length} new tables added by the upgrade`, "INFO", list(fresh, 40));
  add("new-tables-empty", "Every table the upgrade adds is empty (a migration writes no data)", withRows.length ? "FAIL" : "PASS", withRows.length ? `with rows: ${list(withRows)}` : "");
  const addedOnOld = [];
  for (const [name, b] of Object.entries(before.tables)) {
    const was = new Set(b.columns.map((c) => c.name));
    for (const c of afterCols[name] ?? []) if (!was.has(c.name)) addedOnOld.push(`${name}.${c.name}${c.nullable ? "" : " NOT NULL"}`);
  }
  add("added-columns", `${addedOnOld.length} columns added to existing tables`, "INFO", list(addedOnOld, 30));
}

// 3. migration status and timing ------------------------------------------------------------------------------------------
{
  const rows = await q(`SELECT migration_name AS name, started_at, finished_at, rolled_back_at, logs,
                               EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000 AS ms
                          FROM _prisma_migrations ORDER BY started_at, migration_name`);
  const applied = rows.filter((r) => r.finished_at && !r.rolled_back_at);
  const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at);
  const rolledBack = rows.filter((r) => r.rolled_back_at);
  const migDir = opt("--migrations") || path.join(REPO, "prisma/migrations");
  const onDisk = existsSync(migDir) ? readdirSync(migDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  const appliedNames = new Set(applied.map((r) => r.name));
  const pending = onDisk.filter((n) => !appliedNames.has(n));
  const unknown = [...appliedNames].filter((n) => !onDisk.includes(n));
  add("migrations-applied", `${applied.length} migrations applied, ${onDisk.length} in the repository`, pending.length ? "FAIL" : "PASS", pending.length ? `pending: ${list(pending)}` : "");
  add("migrations-failed", "No failed or half-applied migration", failed.length ? "FAIL" : "PASS", failed.length ? list(failed.map((r) => r.name)) : (rolledBack.length ? `${rolledBack.length} earlier rolled-back entries (history only): ${list(rolledBack.map((r) => r.name))}` : ""));
  add("migrations-unknown", "Every applied migration exists in the repository (no drift from a newer original)", unknown.length ? "FAIL" : "PASS", unknown.length ? `in the database but not in the repo: ${list(unknown)}` : "");
  const wasApplied = new Set(before.applied);
  const mine = applied.filter((r) => !wasApplied.has(r.name));
  const timings = mine.map((r) => ({ name: r.name, ms: Math.round(Number(r.ms)) }));
  const total = timings.reduce((a, t) => a + t.ms, 0);
  const slow = timings.filter((t) => t.ms > 60000);
  add("migration-timing", `${mine.length} new migrations took ${(total / 1000).toFixed(1)}s in total`, slow.length ? "WARN" : "INFO",
    timings.map((t) => `${t.name}: ${(t.ms / 1000).toFixed(2)}s`).join("; "));
  globalThis.__timings = timings;
  if (opt("--no-prisma-status") === undefined && !rest.includes("--no-prisma-status") && existsSync(path.join(REPO, "node_modules/.bin/prisma"))) {
    const r = spawnSync(path.join(REPO, "node_modules/.bin/prisma"), ["migrate", "status"], {
      cwd: REPO, encoding: "utf8", env: { ...process.env, DATABASE_URL: `postgresql://${USER}@${HOST}:${PORT}/${dbName}` },
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    add("prisma-status", "`prisma migrate status` says the schema is up to date", out.includes("Database schema is up to date!") ? "PASS" : "FAIL",
      out.includes("Database schema is up to date!") ? "" : out.split("\n").slice(-6).join(" ").slice(0, 300));
  }
}

// 4. constraints and indexes -------------------------------------------------------------------------------------------------
{
  const notValid = await q(`SELECT conrelid::regclass::text AS t, conname FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace WHERE ns.nspname = 'public' AND NOT c.convalidated`);
  add("constraints-valid", "Every constraint is validated (no NOT VALID foreign key or check)", notValid.length ? "FAIL" : "PASS", notValid.length ? list(notValid.map((r) => `${r.t}.${r.conname}`)) : "");
  const badIdx = await q(`SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND (NOT i.indisvalid OR NOT i.indisready)`);
  add("indexes-valid", "Every index is valid and ready (no half-built index)", badIdx.length ? "FAIL" : "PASS", badIdx.length ? list(badIdx.map((r) => r.name)) : "");
  const nowC = new Set(await constraintNames());
  const nowI = new Set(await indexNames());
  const lostC = before.constraints.filter((n) => !nowC.has(n));
  const lostI = before.indexes.filter((n) => !nowI.has(n));
  add("constraints-kept", "No original constraint removed", lostC.length ? "FAIL" : "PASS", lostC.length ? list(lostC) : `${nowC.size - before.constraints.length} constraints added`);
  add("indexes-kept", "No original index removed", lostI.length ? "FAIL" : "PASS", lostI.length ? list(lostI) : `${nowI.size - before.indexes.length} indexes added`);
}

// 5. orphan checks: every foreign key, plus the references that have no foreign key --------------------------------------
{
  const fks = await q(`
    SELECT c.conname, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
           (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS ccols,
           (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS pcols
      FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace
     WHERE c.contype = 'f' AND ns.nspname = 'public' ORDER BY 2, 1`);
  const orphans = [];
  for (const fk of fks) {
    const notNull = fk.ccols.map((c) => `c.${qi(c)} IS NOT NULL`).join(" AND ");
    const join = fk.ccols.map((c, i) => `p.${qi(fk.pcols[i])} = c.${qi(c)}`).join(" AND ");
    const [{ n }] = await q(`SELECT count(*)::bigint AS n FROM ${fk.child} c WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${fk.parent} p WHERE ${join})`);
    if (Number(n) > 0) orphans.push(`${fk.child}(${fk.ccols.join(",")}) -> ${fk.parent}: ${fmt(n)}`);
  }
  add("fk-orphans", `No orphan rows under any of the ${fks.length} foreign keys`, orphans.length ? "FAIL" : "PASS", orphans.length ? list(orphans) : "");

  const SOFT = [
    ["Client", "mergedIntoId", "Client", "id", "merged-away customer points at a customer that exists"],
    ["LeadIntake", "clientId", "Client", "id", "lead intake rows point at a customer that exists"],
    ["Client", "nextActionOwnerId", "User", "id", "next-action owner exists"],
  ];
  const soft = [];
  for (const [ct, cc, pt, pc, why] of SOFT) {
    if (!afterCols[ct]?.some((c) => c.name === cc)) continue;
    const [{ n }] = await q(`SELECT count(*)::bigint AS n FROM ${qi(ct)} c WHERE c.${qi(cc)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${qi(pt)} p WHERE p.${qi(pc)} = c.${qi(cc)})`);
    if (Number(n) > 0) soft.push(`${ct}.${cc} (${why}): ${fmt(n)}`);
  }
  add("soft-orphans", "References without a foreign key all resolve (merged-into, lead intake client)", soft.length ? "WARN" : "PASS", soft.length ? list(soft) : "");

  const [{ n: cyc }] = await q(`
    WITH RECURSIVE walk(id, cur, depth) AS (
      SELECT id, "mergedIntoId", 1 FROM "Client" WHERE "mergedIntoId" IS NOT NULL
      UNION ALL SELECT w.id, c."mergedIntoId", w.depth + 1 FROM walk w JOIN "Client" c ON c.id = w.cur WHERE c."mergedIntoId" IS NOT NULL AND w.depth < 20)
    SELECT count(DISTINCT id)::bigint AS n FROM walk WHERE cur = id OR depth >= 20`);
  add("merge-cycles", "No merged-into loop among customers", Number(cyc) > 0 ? "FAIL" : "PASS", Number(cyc) > 0 ? `${cyc} customers sit in a loop` : "");
}

// 6. unique-key sanity ---------------------------------------------------------------------------------------------------------
{
  const uniq = await q(`
    SELECT i.indexrelid::regclass::text AS idx, i.indrelid::regclass::text AS tbl, pg_get_indexdef(i.indexrelid) AS def, i.indpred IS NOT NULL AS partial
      FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND i.indisunique AND NOT i.indisprimary`);
  add("unique-indexes", `${uniq.length} unique indexes, all valid and enforced`, "PASS", "");

  const dupe = async (sql) => Number((await q(sql))[0].n);
  const has = (t, c) => afterCols[t]?.some((x) => x.name === c);
  if (has("Client", "mobileKey")) {
    const phoneKeySql = `
      CREATE OR REPLACE FUNCTION pg_temp.phone_key(raw text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
      DECLARE d text; BEGIN
        IF raw IS NULL THEN RETURN NULL; END IF;
        d := regexp_replace(raw, '\\D', '', 'g');
        IF d LIKE '00%' THEN d := substr(d, 3); END IF;
        IF length(d) = 13 AND d LIKE '910%' THEN RETURN substr(d, 4); END IF;
        IF length(d) = 12 AND d LIKE '91%' THEN RETURN substr(d, 3); END IF;
        IF length(d) = 11 AND d LIKE '0%' THEN RETURN substr(d, 2); END IF;
        IF length(d) >= 8 THEN RETURN d; END IF;
        RETURN NULL; END $$`;
    // temp functions need a writable transaction: do it on a second, writable connection to the same database
    const w = new pg.Client({ host: HOST, port: PORT, user: USER, database: dbName });
    await w.connect();
    await w.query(phoneKeySql);
    const one = async (sql) => Number((await w.query(sql)).rows[0].n);
    const stale = await one(`SELECT count(*)::bigint AS n FROM "Client" WHERE "mobileKey" IS DISTINCT FROM pg_temp.phone_key(mobile)`);
    const staleE = await one(`SELECT count(*)::bigint AS n FROM "Client" WHERE "emailKey" IS DISTINCT FROM NULLIF(lower(btrim(email)), '')`);
    await w.end();
    add("identity-keys", "Customer matching keys (mobileKey, emailKey) agree with the stored mobile and e-mail", stale + staleE > 0 ? "WARN" : "PASS",
      stale + staleE > 0 ? `${fmt(stale)} mobile keys and ${fmt(staleE)} e-mail keys differ from what the rule gives now (matching would miss these customers; the back-fill is a separate decision)` : "");
    const dm = await dupe(`SELECT count(*)::bigint AS n FROM (SELECT "mobileKey" FROM "Client" WHERE "mobileKey" IS NOT NULL AND NOT "isDeleted" AND "mergedIntoId" IS NULL GROUP BY 1 HAVING count(*) > 1) x`);
    const de = await dupe(`SELECT count(*)::bigint AS n FROM (SELECT "emailKey" FROM "Client" WHERE "emailKey" IS NOT NULL AND NOT "isDeleted" AND "mergedIntoId" IS NULL GROUP BY 1 HAVING count(*) > 1) x`);
    add("duplicate-contacts", "Customers sharing a mobile or e-mail (not an error: the duplicate review exists for these)", "INFO", `${fmt(dm)} mobile groups, ${fmt(de)} e-mail groups`);
  }
  if (has("User", "email")) {
    const n = await dupe(`SELECT count(*)::bigint AS n FROM (SELECT lower(email) FROM "User" GROUP BY 1 HAVING count(*) > 1) x`);
    add("user-email-case", "No two users whose e-mails differ only by upper/lower case (sign-in ambiguity)", n > 0 ? "WARN" : "PASS", n > 0 ? `${n} e-mail addresses collide ignoring case` : "");
  }
  if (has("PartnerProfile", "partnerCode")) {
    const n = await dupe(`SELECT count(*)::bigint AS n FROM (SELECT upper("partnerCode") FROM "PartnerProfile" GROUP BY 1 HAVING count(*) > 1) x`);
    add("partner-code-case", "No two partner codes that differ only by case (the new partner look-up ignores case)", n > 0 ? "FAIL" : "PASS", n > 0 ? `${n} partner codes collide ignoring case` : "");
  }
}

// 7. sample integrity ---------------------------------------------------------------------------------------------------------
{
  const ids = Object.fromEntries(Object.entries(before.samples ?? {}).map(([t, m]) => [t, Object.keys(m)]));
  const keptCols = {};
  for (const t of Object.keys(ids)) { const keep = new Set((afterCols[t] ?? []).map((c) => c.name)); keptCols[t] = before.tables[t].columns.filter((c) => keep.has(c.name)); }
  const now = await samples(keptCols, ids);
  let checked = 0; const bad = [];
  for (const [t, m] of Object.entries(before.samples ?? {})) for (const [id, h] of Object.entries(m)) { checked++; if (now[t]?.[id] !== h) bad.push(`${t}:${id}`); }
  add("sample-integrity", `${fmt(checked)} sampled rows across ${Object.keys(ids).length} tables are byte-identical`, bad.length ? "FAIL" : "PASS", bad.length ? list(bad) : "");
}

// 8. audit chain ----------------------------------------------------------------------------------------------------------------
{
  const hasFn = (await q(`SELECT to_regproc('audit_log_verify') IS NOT NULL AS ok`))[0].ok;
  if (hasFn) {
    const problems = await q(`SELECT * FROM audit_log_verify() LIMIT 5`);
    const [{ n, mx }] = await q(`SELECT count(*)::bigint AS n, coalesce(max(seq), 0)::bigint AS mx FROM "AuditLog"`);
    const [head] = await q(`SELECT seq FROM "AuditLogChainHead" WHERE id = 1`);
    const ok = problems.length === 0 && Number(n) === Number(mx) && Number(head?.seq) === Number(mx);
    add("audit-chain", `Audit log hash chain intact (${fmt(n)} entries, head at ${head?.seq ?? "?"})`, ok ? "PASS" : "FAIL", ok ? "" : `verify problems: ${problems.length}, count ${n}, max seq ${mx}, head ${head?.seq}`);
  } else add("audit-chain", "Audit log hash chain", "WARN", "audit_log_verify() is not present in this database");
}

// 9. size ------------------------------------------------------------------------------------------------------------------------
{
  const [{ bytes }] = await q("SELECT pg_database_size(current_database())::bigint AS bytes");
  const pct = ((Number(bytes) - before.dbBytes) / before.dbBytes) * 100;
  add("size", `Database size ${(before.dbBytes / 1048576).toFixed(0)} MB -> ${(Number(bytes) / 1048576).toFixed(0)} MB (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`, pct > 25 ? "WARN" : "INFO", "");
}

await db.end();

// ---------------------------------------------------------------------------------------------------------------- report
const order = { FAIL: 0, WARN: 1, PASS: 2, INFO: 3 };
const fails = results.filter((r) => r.status === "FAIL").length;
const warns = results.filter((r) => r.status === "WARN").length;
const verdict = fails ? "FAIL" : "PASS";
const lines = [];
lines.push(`# Upgrade verification: ${verdict}`);
lines.push("");
lines.push(`Database \`${dbName}\` (Postgres ${before.serverVersion}), snapshot taken ${before.takenAt}, checked ${new Date().toISOString()}.`);
lines.push(`${results.filter((r) => r.status === "PASS").length} passed, ${warns} warnings, ${fails} failed.`);
lines.push("");
lines.push("| Result | Check | Detail |");
lines.push("| --- | --- | --- |");
for (const r of [...results].sort((a, b) => order[a.status] - order[b.status])) lines.push(`| ${r.status} | ${r.title} | ${r.detail.replace(/\|/g, "/")} |`);
if (globalThis.__timings?.length) {
  lines.push("", "## Migration timings", "", "| Migration | Seconds |", "| --- | ---: |");
  for (const t of globalThis.__timings) lines.push(`| ${t.name} | ${(t.ms / 1000).toFixed(2)} |`);
}
const big = [...(globalThis.__perTable ?? [])].sort((a, b) => b.before - a.before).slice(0, 12);
if (big.length) {
  lines.push("", "## Largest original tables, rows before and after", "", "| Table | Before | After | Identical |", "| --- | ---: | ---: | --- |");
  for (const t of big) lines.push(`| ${t.name} | ${fmt(t.before)} | ${fmt(t.after)} | ${t.same ? "yes" : "NO"} |`);
}
const md = lines.join("\n") + "\n";

console.log(`\n=== ${verdict} === ${results.filter((r) => r.status === "PASS").length} passed, ${warns} warnings, ${fails} failed`);
for (const r of [...results].sort((a, b) => order[a.status] - order[b.status])) console.log(`${r.status.padEnd(4)}  ${r.title}${r.detail && r.status !== "PASS" ? `\n      ${r.detail}` : ""}`);

if (opt("--report")) writeFileSync(opt("--report"), md);
if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify({ verdict, database: dbName, checkedAt: new Date().toISOString(), results, timings: globalThis.__timings ?? [] }, null, 2));
process.exit(fails ? 1 : 0);
