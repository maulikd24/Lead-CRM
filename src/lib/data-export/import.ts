import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { strFromU8, unzipSync } from "fflate";
import type { Pool, PoolClient } from "pg";

import { EXPORT_SCHEMA_VERSION, EXPORT_TABLES, type ExportTable } from "./tables";

// Loads a Supportify export zip into the database behind `pool`. Shared by the CLI (scripts/import-export.ts) and the
// in-app Import screen. Uses plain SQL on its own connection, so it does not trigger the activity log, notifications or
// push the way normal app writes do.

type Row = Record<string, unknown>;
type ColumnInfo = { name: string; nullable: boolean; hasDefault: boolean; generated: boolean; jsonLike: boolean };
type ForeignKey = { column: string; refTable: string; nullable: boolean };
type Manifest = { format: string; schemaVersion: number; exportedAt: string; tables: { table: string; rows: number; sha256: string; excludedColumns: string[] }[] };

export type ImportCredential = { email: string; name: string; role: string; password: string };
export type ImportReport = {
  dryRun: boolean;
  exportedAt: string;
  tables: { table: string; rows: number; present?: number; mismatched?: number }[];
  matched: { table: string; matched: number; total: number; by: string }[];
  usersToCreate: number;
  credentials: ImportCredential[];
  notes: string[];
  existingClients: number;
};

/** A problem the Admin can act on (bad file, schema mismatch) — not a bug. */
export class ImportError extends Error {
  constructor(message: string, readonly details: string[] = []) {
    super(message);
  }
}

const BATCH = 500;
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function readRows(files: Record<string, Uint8Array>, table: string): Row[] {
  const text = strFromU8(files[`data/${table}.ndjson`]);
  return text ? text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Row) : [];
}

export function readExportZip(bytes: Uint8Array) {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ImportError("This is not a valid zip file.");
  }
  if (!files["manifest.json"]) throw new ImportError("This is not a Supportify export — manifest.json is missing.");
  const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Manifest;
  if (manifest.format !== "supportify-export") throw new ImportError(`Unrecognised export format "${manifest.format}".`);
  if (manifest.schemaVersion > EXPORT_SCHEMA_VERSION) {
    throw new ImportError(`This export is schema version ${manifest.schemaVersion}; this app only understands up to ${EXPORT_SCHEMA_VERSION}. Update the app first.`);
  }
  const problems: string[] = [];
  for (const entry of manifest.tables) {
    const data = files[`data/${entry.table}.ndjson`];
    if (!data) {
      problems.push(`${entry.table}: file missing`);
      continue;
    }
    if (sha256(data) !== entry.sha256) problems.push(`${entry.table}: checksum does not match — the file was altered or damaged`);
    const lines = strFromU8(data).split("\n").filter(Boolean).length;
    if (lines !== entry.rows) problems.push(`${entry.table}: expected ${entry.rows} rows, found ${lines}`);
  }
  if (problems.length) throw new ImportError("The export failed its integrity check.", problems);
  return { files, manifest };
}

async function loadSchema(db: PoolClient) {
  const cols = await db.query<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null; is_generated: string; data_type: string }>(
    `SELECT table_name, column_name, is_nullable, column_default, is_generated, data_type FROM information_schema.columns WHERE table_schema = current_schema()`,
  );
  const columns = new Map<string, Map<string, ColumnInfo>>();
  for (const c of cols.rows) {
    if (!columns.has(c.table_name)) columns.set(c.table_name, new Map());
    columns.get(c.table_name)!.set(c.column_name, {
      name: c.column_name,
      nullable: c.is_nullable === "YES",
      hasDefault: c.column_default !== null,
      generated: c.is_generated === "ALWAYS",
      jsonLike: c.data_type === "jsonb" || c.data_type === "json",
    });
  }
  const fkRows = await db.query<{ tbl: string; col: string; reftbl: string }>(
    `SELECT cl.relname AS tbl, att.attname AS col, rcl.relname AS reftbl
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = current_schema()
       JOIN pg_class rcl ON rcl.oid = con.confrelid
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1`,
  );
  const fks = new Map<string, ForeignKey[]>();
  for (const f of fkRows.rows) {
    const nullable = columns.get(f.tbl)?.get(f.col)?.nullable ?? true;
    if (!fks.has(f.tbl)) fks.set(f.tbl, []);
    fks.get(f.tbl)!.push({ column: f.col, refTable: f.reftbl, nullable });
  }
  return { columns, fks };
}

/** Parents before children, from the target database's own foreign keys. Self-references are handled separately. */
function loadOrder(tables: ExportTable[], fks: Map<string, ForeignKey[]>): ExportTable[] {
  const names = new Set(tables.map((t) => t.table));
  const remaining = new Map(tables.map((t) => [t.table, t]));
  const done = new Set<string>();
  const ordered: ExportTable[] = [];
  while (remaining.size) {
    const ready = [...remaining.values()].filter((t) => (fks.get(t.table) ?? []).every((fk) => fk.refTable === t.table || !names.has(fk.refTable) || done.has(fk.refTable)));
    if (ready.length === 0) throw new ImportError(`Cannot order the tables — a circular reference between: ${[...remaining.keys()].join(", ")}`);
    for (const t of ready) {
      ordered.push(t);
      done.add(t.table);
      remaining.delete(t.table);
    }
  }
  return ordered;
}

export async function runImport(options: { bytes: Uint8Array; pool: Pool; dryRun: boolean; log?: (line: string) => void }): Promise<ImportReport> {
  const log = options.log ?? (() => {});
  const { files, manifest } = readExportZip(options.bytes);
  log(`Integrity OK — ${manifest.tables.length} tables, exported ${manifest.exportedAt}`);

  const db = await options.pool.connect();
  const credentials: ImportCredential[] = [];
  const notes: string[] = [];
  const skipped = new Map<string, Set<string>>();
  const matchedReport: ImportReport["matched"] = [];

  try {
    const { columns, fks } = await loadSchema(db);
    const exportTables = EXPORT_TABLES.filter((t) => manifest.tables.some((m) => m.table === t.table));
    const exported = new Set(exportTables.map((t) => t.table));

    const errors: string[] = [];
    for (const t of exportTables) {
      const targetCols = columns.get(t.table);
      if (!targetCols) {
        errors.push(`${t.table}: table does not exist here — run \`npx prisma migrate deploy\` first`);
        continue;
      }
      const sample = readRows(files, t.table)[0];
      if (!sample) continue;
      const exportedCols = new Set(Object.keys(sample));
      for (const c of targetCols.values()) {
        if (c.generated || c.nullable || c.hasDefault || exportedCols.has(c.name)) continue;
        if (t.table === "User" && c.name === "passwordHash") continue; // generated per imported user
        errors.push(`${t.table}.${c.name}: required here but not in the export`);
      }
      for (const fk of fks.get(t.table) ?? []) {
        if (!exported.has(fk.refTable) && exportedCols.has(fk.column) && !fk.nullable) errors.push(`${t.table}.${fk.column}: points to ${fk.refTable}, which is not in the export, and cannot be empty`);
      }
      const dropped = [...exportedCols].filter((c) => !targetCols.has(c));
      if (dropped.length) notes.push(`${t.table}: ignoring ${dropped.length} column(s) this version no longer has (${dropped.join(", ")})`);
    }
    if (errors.length) throw new ImportError("Cannot import into this database.", errors);

    const ordered = loadOrder(exportTables, fks);

    // Natural-key matching: users by email, stages by name, products by code.
    const idMap = new Map<string, Map<string, string>>();
    const matchOn: Record<string, { key: string; lower?: boolean }> = { User: { key: "email", lower: true }, Stage: { key: "name" }, Product: { key: "productCode" } };
    for (const [table, { key, lower }] of Object.entries(matchOn)) {
      if (!exported.has(table)) continue;
      const rows = readRows(files, table);
      const norm = (v: unknown) => (lower ? String(v).toLowerCase() : String(v));
      const existing = await db.query<{ id: string; k: string }>(`SELECT id, ${lower ? `lower(${q(key)})` : q(key)} AS k FROM ${q(table)}`);
      const byKey = new Map(existing.rows.map((r) => [r.k, r.id]));
      const map = new Map<string, string>();
      const matched = new Set<string>();
      for (const row of rows) {
        const hit = byKey.get(norm(row[key]));
        if (hit) {
          map.set(String(row.id), hit);
          matched.add(String(row.id));
        }
      }
      idMap.set(table, map);
      skipped.set(table, matched);
      matchedReport.push({ table, matched: matched.size, total: rows.length, by: key });
      log(`${table}: ${matched.size} of ${rows.length} already here (matched by ${key}), ${rows.length - matched.size} to create`);
    }
    const remapped = [...idMap.values()].flatMap((m) => [...m].filter(([from, to]) => from !== to));
    const remapPattern = remapped.length ? new RegExp(remapped.map(([from]) => from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
    const remapLookup = new Map(remapped);
    const mapId = (table: string, value: unknown) => (typeof value === "string" ? idMap.get(table)?.get(value) ?? value : value);

    type Prepared = { table: ExportTable; insertCols: string[]; rows: Row[]; selfCols: string[]; nulled: Record<string, number> };
    const prepare = (t: ExportTable): Prepared => {
      const targetCols = columns.get(t.table)!;
      const source = readRows(files, t.table).filter((r) => !skipped.get(t.table)?.has(String(r[t.pk ?? "id"])));
      const tableFks = fks.get(t.table) ?? [];
      const fkByCol = new Map(tableFks.map((fk) => [fk.column, fk]));
      const nulled: Record<string, number> = {};
      const rows = source.map((raw) => {
        const row: Row = {};
        for (const [name, value] of Object.entries(raw)) {
          const info = targetCols.get(name);
          if (!info || info.generated) continue;
          const fk = fkByCol.get(name);
          if (fk && value !== null) {
            if (!exported.has(fk.refTable)) {
              row[name] = null;
              nulled[name] = (nulled[name] ?? 0) + 1;
              continue;
            }
            row[name] = mapId(fk.refTable, value);
          } else if (info.jsonLike && remapPattern && value !== null) {
            row[name] = JSON.parse(JSON.stringify(value).replace(remapPattern, (id) => remapLookup.get(id) ?? id));
          } else {
            row[name] = value;
          }
        }
        if (t.table === "User") {
          const password = randomBytes(9).toString("base64url");
          row.passwordHash = bcrypt.hashSync(password, 10);
          if (targetCols.has("mustChangePassword")) row.mustChangePassword = true;
          credentials.push({ email: String(row.email), name: String(row.name), role: String(row.role), password });
        }
        return row;
      });
      const insertCols = rows.length ? Object.keys(rows[0]) : [];
      const selfCols = tableFks.filter((fk) => fk.refTable === t.table && fk.nullable && insertCols.includes(fk.column)).map((fk) => fk.column);
      return { table: t, insertCols, rows, selfCols, nulled };
    };

    const prepared = ordered.map(prepare);
    for (const p of prepared) for (const [col, n] of Object.entries(p.nulled)) notes.push(`${p.table.table}.${col}: ${n} link(s) to data that is not part of an export were left empty`);

    const existingClients = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM "Client"`)).rows[0].n);
    const report: ImportReport = {
      dryRun: options.dryRun,
      exportedAt: manifest.exportedAt,
      tables: prepared.map((p) => ({ table: p.table.table, rows: p.rows.length })),
      matched: matchedReport,
      usersToCreate: credentials.length,
      credentials: options.dryRun ? [] : credentials,
      notes,
      existingClients,
    };
    if (options.dryRun) return report;

    log("Importing (one transaction — all or nothing) …");
    await db.query("BEGIN");
    try {
      for (const p of prepared) {
        const { table, insertCols, rows, selfCols } = p;
        const pk = table.pk ?? "id";
        if (rows.length === 0) continue;
        const updatable = insertCols.filter((c) => c !== pk);
        const colList = insertCols.map(q).join(", ");
        const conflict = updatable.length ? `ON CONFLICT (${q(pk)}) DO UPDATE SET ${updatable.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(", ")}` : `ON CONFLICT (${q(pk)}) DO NOTHING`;
        const sql = `INSERT INTO ${q(table.table)} (${colList}) SELECT ${colList} FROM jsonb_populate_recordset(null::${q(table.table)}, $1::jsonb) ${conflict}`;
        for (const batch of chunk(rows, BATCH)) {
          // A self-reference (a merged client, a user's manager) may point at a row later in the file: insert it empty first.
          const first = selfCols.length ? batch.map((r) => ({ ...r, ...Object.fromEntries(selfCols.map((c) => [c, null])) })) : batch;
          await db.query(sql, [JSON.stringify(first)]);
        }
        if (selfCols.length) {
          for (const batch of chunk(rows, BATCH)) {
            const patch = batch.map((r) => ({ [pk]: r[pk], ...Object.fromEntries(selfCols.map((c) => [c, r[c]])) })).filter((r) => selfCols.some((c) => r[c] !== null));
            if (patch.length === 0) continue;
            await db.query(
              `UPDATE ${q(table.table)} t SET ${selfCols.map((c) => `${q(c)} = s.${q(c)}`).join(", ")} FROM jsonb_populate_recordset(null::${q(table.table)}, $1::jsonb) s WHERE t.${q(pk)} = s.${q(pk)}`,
              [JSON.stringify(patch)],
            );
          }
        }
        log(`${table.table}: ${rows.length}`);
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    // Verify every imported row is in the database, cell for cell.
    log("Verifying …");
    for (const p of prepared) {
      const { table, insertCols, rows } = p;
      if (rows.length === 0) continue;
      const pk = table.pk ?? "id";
      const cmp = insertCols.map((c) => q(c));
      let mismatched = 0;
      let present = 0;
      for (const batch of chunk(rows, BATCH)) {
        const res = await db.query<{ present: string; mismatched: string }>(
          `SELECT count(t.${q(pk)}) AS present,
                  count(*) FILTER (WHERE t.${q(pk)} IS NOT NULL AND ROW(${cmp.map((c) => `t.${c}`).join(", ")}) IS DISTINCT FROM ROW(${cmp.map((c) => `s.${c}`).join(", ")})) AS mismatched
             FROM jsonb_populate_recordset(null::${q(table.table)}, $1::jsonb) s LEFT JOIN ${q(table.table)} t ON t.${q(pk)} = s.${q(pk)}`,
          [JSON.stringify(batch)],
        );
        present += Number(res.rows[0].present);
        mismatched += Number(res.rows[0].mismatched);
      }
      const entry = report.tables.find((t) => t.table === table.table)!;
      entry.present = present;
      entry.mismatched = mismatched;
    }
    const bad = report.tables.filter((t) => t.present !== undefined && (t.present !== t.rows || t.mismatched));
    if (bad.length) throw new ImportError("The data was written but did not verify.", bad.map((t) => `${t.table}: ${t.present}/${t.rows} present, ${t.mismatched} differ`));
    return report;
  } finally {
    db.release();
  }
}
