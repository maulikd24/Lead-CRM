#!/usr/bin/env node
// Fails when application code calls a model SDK, a vendor URL or a raw provider factory outside the AI gateway.
//   node scripts/ci/ai-boundary.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { scanFile } from "./lib/ai-boundary.mjs";

const root = process.cwd();
const SKIP = new Set(["node_modules", ".next", "generated", ".git", "coverage"]);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

const violations = [];
for (const top of ["src", "scripts", "whatsapp-worker"]) {
  let files = [];
  try { files = walk(path.join(root, top)); } catch { continue; }
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    if (rel.startsWith("scripts/ci/lib/ai-boundary")) continue;
    violations.push(...scanFile(rel, readFileSync(f, "utf8")));
  }
}
if (violations.length) {
  for (const v of violations) console.error(`  ${v.path}:${v.line}  [${v.rule}] ${v.why}\n      ${v.text}`);
  console.error(`ai boundary: FAIL (${violations.length} direct model call(s) outside the gateway)`);
  process.exit(1);
}
console.log("ai boundary: PASS (no direct model SDK, vendor URL or provider factory use outside the gateway)");
