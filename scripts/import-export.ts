// Loads a Supportify data export (the zip from Settings → Data Export) into a Supportify database — run this on the NEW
// server against the NEW database, after `prisma migrate deploy` has created the tables.
//
//   npm run import:data -- path/to/supportify-export.zip --dry-run        # check only, writes nothing
//   npm run import:data -- path/to/supportify-export.zip --yes            # import
//   npm run import:data -- path/to/supportify-export.zip --yes --database-url postgres://...
//
// It is safe to run twice (rows are upserted by their original id) and all-or-nothing (one transaction). Users, stages and
// products are matched to what the target already has (email / name / product code) so nothing is duplicated; every
// reference is rewritten to point at the match. Imported users get a temporary password, written to
// imported-users-credentials.csv — they must change it on first sign-in.
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { Pool } from "pg";

import { ImportError, runImport } from "../src/lib/data-export/import";

function parseArgs() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const value = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--database-url");
  return { file, dryRun: flag("--dry-run"), yes: flag("--yes"), databaseUrl: value("--database-url") ?? process.env.DATABASE_URL };
}

function fail(message: string, details: string[] = []): never {
  console.error(`\n✗ ${message}${details.length ? `\n  - ${details.join("\n  - ")}` : ""}`);
  process.exit(1);
}

async function main() {
  const { file, dryRun, yes, databaseUrl } = parseArgs();
  if (!file) fail("Usage: npm run import:data -- <export.zip> [--dry-run] [--yes] [--database-url <url>]");
  if (!databaseUrl) fail("No database to import into — set DATABASE_URL or pass --database-url.");
  if (!dryRun && !yes) fail("This writes to the database. Re-run with --dry-run to check first, or add --yes to import.");
  if (!existsSync(file)) fail(`File not found: ${file}`);

  const target = new URL(databaseUrl.replace(/^prisma\+postgres/, "postgres"));
  console.log(`Reading ${basename(file)} …`);
  console.log(`Target database: ${target.hostname}:${target.port || 5432}${target.pathname}${dryRun ? "  (dry run — nothing will be written)" : ""}`);

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const report = await runImport({ bytes: new Uint8Array(readFileSync(resolve(file))), pool, dryRun, log: (line) => console.log(`  ${line}`) });
    console.log(dryRun ? "\nWould import:" : "\nImported:");
    for (const t of report.tables) {
      const check = t.present === undefined ? "" : t.present === t.rows && !t.mismatched ? "  ✓" : "  ✗";
      console.log(`  ${t.table.padEnd(26)} ${String(t.rows).padStart(7)} rows${check}`);
    }
    for (const n of report.notes) console.log(`  note: ${n}`);
    if (dryRun) {
      if (report.usersToCreate) console.log(`\n${report.usersToCreate} user(s) would be created with temporary passwords.`);
      console.log("\n✓ Dry run finished — nothing was written.");
      return;
    }
    if (report.credentials.length) {
      const path = resolve("imported-users-credentials.csv");
      const csv = ["email,name,role,temporaryPassword", ...report.credentials.map((c) => [c.email, c.name, c.role, c.password].map((v) => `"${v.replace(/"/g, '""')}"`).join(","))].join("\n");
      writeFileSync(path, `${csv}\n`, { mode: 0o600 });
      console.log(`\n${report.credentials.length} user(s) created. Temporary passwords are in ${path} — hand them out securely, then delete the file.`);
    }
    console.log("\n✓ Import complete and verified.");
    console.log("Next: sign in as an Admin, then Settings → Apps & Integrations to re-enter API keys (they are never exported).");
  } catch (error) {
    if (error instanceof ImportError) fail(error.message, error.details);
    throw error;
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
