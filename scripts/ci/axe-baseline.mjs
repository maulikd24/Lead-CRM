#!/usr/bin/env node
// Merge e2e/.axe/<role>.json (written by `AXE_WRITE_BASELINE=1 npm run ci:e2e -- --axe`) into ci/axe-baseline.json.
// Refuses to ADD entries unless --allow-add is passed (adding is only for the first baseline); removing is always fine.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const file = "ci/axe-baseline.json";
const base = JSON.parse(readFileSync(file, "utf8"));
const allowAdd = process.argv.includes("--allow-add");
let added = 0, removed = 0;
for (const f of existsSync("e2e/.axe") ? readdirSync("e2e/.axe") : []) {
  const role = f.replace(/\.json$/, "");
  const found = JSON.parse(readFileSync(`e2e/.axe/${f}`, "utf8"));
  const old = new Set(base.violations[role] ?? []);
  const next = allowAdd ? found : found.filter((x) => old.has(x));
  added += next.filter((x) => !old.has(x)).length;
  removed += [...old].filter((x) => !next.includes(x)).length;
  base.violations[role] = next;
}
writeFileSync(file, JSON.stringify(base, null, 2) + "\n");
console.log(`axe baseline: +${added} -${removed}`);
