// Guard for the data export: every model in prisma/schema.prisma must be either exported or deliberately excluded (with a
// reason), and no exported column may look like a secret unless it is explicitly left out. Run after any schema change:
//
//   npm run check:export
//
// Exits non-zero on a gap, so it can sit in CI.
import { readFileSync } from "node:fs";

import { EXCLUDED_BY_DESIGN, EXPORT_TABLES } from "../src/lib/data-export/tables";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const models = new Map<string, string[]>();
for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const fields = match[2]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//") && !line.startsWith("@@"))
    // scalar columns only: relation fields have a model type (capitalised, not a known scalar/enum is handled below)
    .map((line) => line.split(/\s+/))
    .filter(([, type]) => type && /^(String|Int|Float|Decimal|Boolean|DateTime|Json|BigInt|Bytes)\b/.test(type))
    .map(([name]) => name);
  models.set(match[1], fields);
}

const problems: string[] = [];
const exported = new Map(EXPORT_TABLES.map((t) => [t.table, t]));

for (const model of models.keys()) {
  if (!exported.has(model) && !(model in EXCLUDED_BY_DESIGN)) {
    problems.push(`Model "${model}" is neither exported nor listed in EXCLUDED_BY_DESIGN — add it to src/lib/data-export/tables.ts.`);
  }
  if (exported.has(model) && model in EXCLUDED_BY_DESIGN) problems.push(`Model "${model}" is both exported and excluded.`);
}
for (const name of [...exported.keys(), ...Object.keys(EXCLUDED_BY_DESIGN)]) {
  if (!models.has(name)) problems.push(`"${name}" is in the export registry but is not a model in schema.prisma.`);
}

// Columns whose name looks secret but which hold nothing sensitive. Keep this list short and justified.
const ALLOWED_SECRET_LIKE = new Set<string>();

const SECRET_LIKE = /password|passwd|secret|token|credential|apikey|api_key|hash|mfa|otp/i;
for (const table of EXPORT_TABLES) {
  const fields = models.get(table.table) ?? [];
  for (const excluded of table.exclude ?? []) {
    if (!fields.includes(excluded)) problems.push(`${table.table}.${excluded} is excluded from the export but is not a column any more — remove it from the list.`);
  }
  for (const field of fields) {
    if (SECRET_LIKE.test(field) && !(table.exclude ?? []).includes(field) && !ALLOWED_SECRET_LIKE.has(`${table.table}.${field}`)) {
      problems.push(`${table.table}.${field} looks like a secret and IS exported — exclude it in tables.ts, or (if it is harmless) add \"Table.column\" to ALLOWED_SECRET_LIKE in this script.`);
    }
  }
}

if (problems.length) {
  console.error(`✗ Data export registry has ${problems.length} gap(s):\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✓ Data export registry covers all ${models.size} models (${exported.size} exported, ${Object.keys(EXCLUDED_BY_DESIGN).length} excluded by design).`);
