#!/usr/bin/env node
// Synthetic legacy database: build a messy database in the ORIGINAL (upstream main) schema state, upgrade it with the
// train's migrations, and prove nothing that existed before changed. SYNTHETIC DATA ONLY; see README.md.
//
//   node scripts/ci/legacy-db/run.mjs                      scale 1 (about 0.4M rows), build + upgrade + verify
//   LEGACY_SCALE=10 node scripts/ci/legacy-db/run.mjs      nightly size (about 4M rows); --scale <n> does the same
//   --scale 0.05                                           tiny (a few seconds), for quick local runs
//   --generate-only [--db <name>]                          build the legacy DB and stop (keeps it), e.g. to rehearse by hand
//   --determinism                                          build twice, assert byte-identical table hashes
//
// Steps: 1 apply upstream main's migrations (pinned baseline)  2 load synthetic rows  3 snapshot
//        4 apply the train's migrations  5 verify (rows/content identical, constraints/indexes kept, audit chain, FKs)
//        6 schema equals a from-empty build  7 time budget  8 hygiene (only synthetic identifiers exist)
import { readFileSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { baselineRef, exportBaseline } from "../lib/baseline.mjs";
import { PREFIX, assertScratch, client, createDb, dropDb, pgDumpSchema, prisma, psql, run } from "../lib/db.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const SCALE = Number(opt("--scale") ?? process.env.LEGACY_SCALE ?? "1");
if (!(SCALE > 0 && SCALE <= 14)) { console.error("LEGACY_SCALE must be in (0, 14] (the synthetic mobile range holds about 142k contacts)"); process.exit(2); }
const BUDGET_S = Number(process.env.LEGACY_BUDGET_S ?? 60 * Math.max(1, SCALE));
const ANCHOR = "2026-10-01T00:00:00Z";
const size = { clients: Math.max(500, Math.round(10000 * SCALE)), leads: Math.max(500, Math.round(40000 * SCALE)), activities: Math.max(500, Math.round(40000 * SCALE)), messages: Math.max(500, Math.round(150000 * SCALE)) };
const tmp = mkdtempSync(path.join(os.tmpdir(), "ci-legacy-"));
const ref = baselineRef();
const sec = (t0) => ((Date.now() - t0) / 1000).toFixed(1);
const log = (m) => console.log(m);

async function buildLegacy(db) {
  const base = exportBaseline(ref, path.join(tmp, `baseline-${db}`));
  await createDb(db);
  let t = Date.now();
  const a = prisma(["migrate", "deploy"], db, { schema: base.schema, migrations: base.migrations });
  if (a.status !== 0) throw new Error(`baseline migrations failed:\n${(a.stderr || a.stdout).slice(-1500)}`);
  log(`  original schema built: upstream ${ref}, ${base.count} migrations, ${sec(t)}s`);
  t = Date.now();
  const s = psql(db, ["-v", `clients=${size.clients}`, "-v", `leads=${size.leads}`, "-v", `activities=${size.activities}`, "-v", `messages=${size.messages}`, "-v", `anchor=${ANCHOR}`, "-f", path.join(root, "scripts/ci/legacy-db/seed-legacy.sql")]);
  if (s.status !== 0) throw new Error(`synthetic load failed:\n${(s.stderr || s.stdout).slice(-2000)}`);
  const c = await client(db);
  try {
    const q = async (t2) => Number((await c.query(`SELECT count(*) AS n FROM "${t2}"`)).rows[0].n);
    log(`  synthetic rows loaded in ${sec(t)}s: Client=${await q("Client")} LeadIntake=${await q("LeadIntake")} Activity=${await q("Activity")} Message=${await q("Message")} AuditLog=${await q("AuditLog")}`);
  } finally { await c.end(); }
}

const verify = (...a) => run("node", [path.join(root, "scripts/ci/legacy-db/verify.mjs"), ...a], { cwd: root });

async function hygiene(db) {
  const c = await client(db);
  const problems = [];
  try {
    const one = async (sql) => Number((await c.query(sql)).rows[0].n);
    const badEmail = await one(`SELECT count(*) AS n FROM "Client" WHERE email IS NOT NULL AND lower(btrim(email)) NOT LIKE '%@example.invalid'`);
    const badUser = await one(`SELECT count(*) AS n FROM "User" WHERE lower(email) NOT LIKE '%@example.invalid'`);
    const badMobile = await one(`SELECT count(*) AS n FROM "Client" WHERE mobile IS NOT NULL AND regexp_replace(regexp_replace(regexp_replace(mobile, '\\D', '', 'g'), '^(0091|91|0)(?=\\d{10}$)', ''), '\\D', '', 'g') !~ '^9000\\d{6}$'`);
    const badUrl = await one(`SELECT count(*) AS n FROM "Message" WHERE "mediaUrl" IS NOT NULL AND "mediaUrl" NOT LIKE 'https://example.invalid/%'`);
    const badHash = await one(`SELECT count(*) AS n FROM "User" WHERE "passwordHash" <> 'synthetic-placeholder-not-a-hash'`);
    if (badEmail) problems.push(`${badEmail} client e-mails outside @example.invalid`);
    if (badUser) problems.push(`${badUser} user e-mails outside @example.invalid`);
    if (badMobile) problems.push(`${badMobile} client mobiles outside the synthetic 9000xxxxxx range`);
    if (badUrl) problems.push(`${badUrl} media URLs outside example.invalid`);
    if (badHash) problems.push(`${badHash} users with a real-looking password hash`);
  } finally { await c.end(); }
  return problems;
}

const checks = [];
const check = (title, ok, detail = "") => { checks.push({ title, ok }); log(`${ok ? "PASS" : "FAIL"}  ${title}${detail ? ` (${detail})` : ""}`); };
const LEG = `${PREFIX}legacy_up`, EMPTY = `${PREFIX}legacy_empty`, TWIN = `${PREFIX}legacy_twin`;
const keep = flag("--generate-only") || process.env.CI_KEEP_DB === "1";

try {
  log(`synthetic legacy database: scale ${SCALE} (${size.clients} clients, ${size.leads} leads, ${size.activities} activities, ${size.messages} messages)`);

  if (flag("--generate-only")) {
    const db = assertScratch(opt("--db") ?? LEG);
    await buildLegacy(db);
    log(`ready: ${db} (original schema + synthetic data). Drop with: dropdb ${db}`);
    process.exit(0);
  }

  if (flag("--determinism")) {
    await buildLegacy(LEG); await buildLegacy(TWIN);
    const snap = (db) => { const f = path.join(tmp, `${db}.json`); const r = verify("snapshot", db, f); if (r.status !== 0) throw new Error(r.stdout + r.stderr); const j = JSON.parse(readFileSync(f, "utf8")); return Object.fromEntries(Object.entries(j.tables).map(([t, v]) => [t, `${v.rows}:${v.hash}`])); };
    const a = snap(LEG), b = snap(TWIN);
    const differ = Object.keys(a).filter((t) => a[t] !== b[t]);
    check(`two builds produce identical rows (${Object.keys(a).length} tables hashed)`, differ.length === 0, differ.length ? `differ: ${differ.join(", ")}` : "");
  } else {
    await buildLegacy(LEG);
    const before = path.join(tmp, "before.json");
    let r = verify("snapshot", LEG, before);
    if (r.status !== 0) throw new Error(`snapshot failed:\n${r.stdout}${r.stderr}`);
    log(`  ${r.stdout.trim()}`);
    check("hygiene: only synthetic identifiers exist before the upgrade", (await hygiene(LEG)).length === 0, (await hygiene(LEG)).join("; "));

    const t0 = Date.now();
    const up = prisma(["migrate", "deploy"], LEG);
    const upSec = (Date.now() - t0) / 1000;
    check("train migrations apply over the legacy database", up.status === 0, up.status === 0 ? `${upSec.toFixed(1)}s` : (up.stderr || up.stdout).slice(-1200));
    if (up.status === 0) {
      r = verify("check", LEG, before, "--report", path.join(tmp, "report.md"), "--json", path.join(tmp, "result.json"));
      const res = JSON.parse(readFileSync(path.join(tmp, "result.json"), "utf8"));
      const bad = res.results.filter((x) => x.status === "FAIL");
      const pass = res.results.filter((x) => x.status === "PASS").length;
      const warn = res.results.filter((x) => x.status === "WARN");
      check(`verify: original tables unchanged (${pass} checks passed, ${warn.length} warnings)`, r.status === 0, bad.map((x) => `${x.title}: ${x.detail}`).join(" | "));
      for (const w of warn) log(`  warning: ${w.title}: ${w.detail}`);
      if (process.env.LEGACY_REPORT) writeFileSync(process.env.LEGACY_REPORT, readFileSync(path.join(tmp, "report.md")));

      await createDb(EMPTY);
      const e = prisma(["migrate", "deploy"], EMPTY);
      const same = e.status === 0 && pgDumpSchema(EMPTY) === pgDumpSchema(LEG);
      check("schema after the upgrade equals the schema built from empty", same);
      check(`upgrade time within budget (${BUDGET_S}s)`, upSec < BUDGET_S, `${upSec.toFixed(1)}s`);
      const h = await hygiene(LEG);
      check("hygiene: still only synthetic identifiers after the upgrade", h.length === 0, h.join("; "));
    }
  }
} catch (e) {
  check("run", false, String(e?.message ?? e));
} finally {
  rmSync(tmp, { recursive: true, force: true });
  if (!keep) for (const d of [LEG, EMPTY, TWIN]) await dropDb(d);
}

const failed = checks.filter((c) => !c.ok);
log(`\nlegacy database check: ${failed.length ? "FAIL" : "PASS"} (${checks.length - failed.length}/${checks.length})`);
process.exit(failed.length ? 1 : 0);
