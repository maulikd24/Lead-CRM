// Static checks over the migration folders (pure functions, no I/O). Used by scripts/ci/migration-order.mjs.
//
//   bad-name / duplicate-timestamp   folder names must be <14 digits>_<snake_case> and unique by timestamp
//   before-baseline                  a migration the train adds must sort AFTER the last migration upstream already has
//   out-of-order                     a migration introduced later (by git history) must not sort before one introduced earlier
//   duplicate-enum-value             two migrations adding the same value to the same enum (the second would fail on a fresh DB)
//   non-additive                     DROP, ALTER ... DROP / ALTER COLUMN / RENAME, TRUNCATE, DELETE, UPDATE, NOT NULL column without default
//
// The additive rule applies only to migrations that are NOT in `baseline` (upstream main's migrations are already shared and
// history cannot be edited). `allow` holds normalised statements that are tolerated (the known pre-existing foreign key drift).

/** Collapse whitespace and drop the trailing semicolon, so the same statement compares equal however it was laid out. */
export const normalise = (stmt) => stmt.replace(/\s+/g, " ").replace(/\s*;\s*$/, "").trim();

/** Split SQL into statements, ignoring `--` and block comments, quoted strings/identifiers and dollar-quoted bodies. */
export function splitStatements(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  const push = () => { const s = cur.replace(/\s+/g, " ").trim(); if (s) out.push(s); cur = ""; };
  while (i < n) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === "--") { while (i < n && sql[i] !== "\n") i++; continue; }
    if (two === "/*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; cur += " "; continue; }
    if (c === "'" || c === '"') {
      const q = c; cur += c; i++;
      while (i < n) { cur += sql[i]; if (sql[i] === q) { if (sql[i + 1] === q) { cur += sql[i + 1]; i += 2; continue; } i++; break; } i++; }
      continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const e = sql.indexOf(tag, i + tag.length);
        const end = e < 0 ? n : e + tag.length;
        cur += sql.slice(i, end); i = end; continue;
      }
    }
    if (c === ";") { cur += ";"; i++; push(); continue; }
    cur += c; i++;
  }
  push();
  return out;
}

const NAME = /^(\d{14})_[a-z0-9_]+$/;
const ADD_VALUE = /^ALTER TYPE\s+("?[\w]+"?)\s+ADD VALUE\s+(IF NOT EXISTS\s+)?'([^']+)'/i;

function nonAdditive(stmt) {
  const s = stmt.replace(/^\s+/, "");
  if (/^DROP\s/i.test(s)) return "DROP";
  if (/^TRUNCATE\b/i.test(s)) return "TRUNCATE";
  if (/^DELETE\s+FROM\b/i.test(s)) return "DELETE";
  if (/^UPDATE\b/i.test(s)) return "UPDATE";
  if (/^ALTER\s+(TABLE|TYPE|INDEX|SEQUENCE|VIEW)\b/i.test(s)) {
    if (/\bDROP\b/i.test(s)) return "ALTER ... DROP";
    if (/\bRENAME\b/i.test(s)) return "RENAME";
    if (/\bALTER\s+COLUMN\b/i.test(s)) return "ALTER COLUMN";
    // a new NOT NULL column with no default breaks every existing row
    for (const part of s.split(/,\s*(?=ADD\b)/i)) {
      if (/\bADD\s+COLUMN\b/i.test(part) && /\bNOT NULL\b/i.test(part) && !/\bDEFAULT\b/i.test(part)) return "ADD COLUMN NOT NULL without DEFAULT";
    }
  }
  return null;
}

export function lintMigrations(migrations, { baseline = new Set(), allow = new Set() } = {}) {
  const problems = [];
  const add = (kind, migration, detail) => problems.push({ kind, migration, detail });
  const sorted = [...migrations].sort((a, b) => (a.name < b.name ? -1 : 1));

  const seenTs = new Map();
  for (const { name } of sorted) {
    const m = NAME.exec(name);
    if (!m) { add("bad-name", name, "folder name must be <14 digit timestamp>_<snake_case>"); continue; }
    if (seenTs.has(m[1])) add("duplicate-timestamp", name, `same timestamp as ${seenTs.get(m[1])}`);
    else seenTs.set(m[1], name);
  }

  const lastBaseline = sorted.filter((m) => baseline.has(m.name)).map((m) => m.name).pop();
  if (lastBaseline) for (const { name } of sorted) if (!baseline.has(name) && name < lastBaseline) add("before-baseline", name, `sorts before upstream's last migration ${lastBaseline}; a database that already ran it would apply this one out of order`);

  const enumFirst = new Map();
  for (const { name, sql } of sorted) {
    for (const stmt of splitStatements(sql)) {
      const ev = ADD_VALUE.exec(stmt);
      if (ev) {
        const key = `${ev[1].replace(/"/g, "")}.${ev[3]}`;
        if (enumFirst.has(key)) { if (!ev[2]) add("duplicate-enum-value", name, `${key.replace(".", " value ")} is already added by ${enumFirst.get(key)}`); }
        else enumFirst.set(key, name);
      }
      if (baseline.has(name)) continue;
      const why = nonAdditive(stmt);
      if (why && !allow.has(normalise(stmt))) add("non-additive", name, `${why}: ${stmt.slice(0, 120)}`);
    }
  }
  return { problems };
}

/** groups: names of the migrations introduced by each successive merge/commit, oldest first. */
export function checkIntroductionOrder(groups) {
  const problems = [];
  let maxName = null;
  for (const group of groups) {
    for (const name of group) {
      if (maxName && name < maxName) problems.push({ kind: "out-of-order", migration: name, detail: `${name} was introduced after ${maxName} but sorts before it, so a database that already ran ${maxName} would apply it out of order` });
    }
    for (const name of group) if (!maxName || name > maxName) maxName = name;
  }
  return problems;
}
