/**
 * npm run flags:check - the CI check. Fails (exit 1) on:
 *   1. a name read in src, scripts, prisma, e2e or the config files that is not in the registry or ci/flags-allowlist.txt (FR-01)
 *   2. a registered flag without an owner, a description, or a mention in docs/feature-flags.md (undocumented)
 *   3. a profile that does not validate (with assumeCredentials)
 *   4. a committed docs/feature-flags.md or docs/profiles/*.env that differs from what the registry generates
 * Warns (exit 0) on a registered name that nothing references (FR-31). Reads no environment value.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { PROFILES, PROFILE_NAMES } from "../../src/lib/flags/profiles";
import { REGISTRY, isFlagDef, isRegistered } from "../../src/lib/flags/registry";
import { checkNames, parseAllowList, scanSource, unreferenced, type ScanFile } from "../../src/lib/flags/scan";
import { validateFlags } from "../../src/lib/flags/validate";
import { expectedFiles, readIfExists } from "./generated";

const root = process.cwd();
const SCAN_DIRS = ["src", "scripts", "prisma", "e2e", "whatsapp-worker/src"];
const SCAN_FILES = ["next.config.ts", "playwright.config.ts", "prisma.config.ts", "vitest.config.ts"];
const SKIP_DIR = new Set(["node_modules", ".next", "generated", ".git", "dist"]);

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (SKIP_DIR.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");
const paths = [...SCAN_DIRS.flatMap((d) => walk(path.join(root, d))), ...SCAN_FILES.map((f) => path.join(root, f))];
const all: ScanFile[] = paths.flatMap((p) => {
  try {
    return [{ path: rel(p), text: readFileSync(p, "utf8") }];
  } catch {
    return [];
  }
});
// The flag library and this tool describe names (and test with made-up ones); they are not readers of the environment.
const readers = all.filter((f) => !f.path.startsWith("src/lib/flags/") && !f.path.startsWith("scripts/flags/"));

const allowList = parseAllowList(readIfExists(path.join(root, "ci/flags-allowlist.txt")) ?? "");
const errors: string[] = [];
const warnings: string[] = [];

// 1. unknown names
for (const f of checkNames(scanSource(readers), { isRegistered, allowList })) errors.push(`FR-01 ${f.message} (${f.files.join(", ")})`);

// 2. undocumented
const docs = readIfExists(path.join(root, "docs/feature-flags.md")) ?? "";
for (const f of REGISTRY) {
  if (isFlagDef(f) && (!f.owner || !f.label || f.enables.length < 15)) errors.push(`undocumented: ${f.name} has no owner, label or description in the registry`);
  if (!docs.includes("`" + f.name + "`")) errors.push(`undocumented: ${f.name} is not in docs/feature-flags.md (run npm run flags:docs)`);
}

// 3. profiles
for (const name of PROFILE_NAMES) {
  for (const [label, env] of [["today", PROFILES[name].values], ["with planned", { ...PROFILES[name].values, ...PROFILES[name].planned }]] as const) {
    const r = validateFlags(env, { context: "ci", profile: name, assumeCredentials: true });
    for (const e of r.errors) errors.push(`profile ${name} (${label}): ${e.rule} ${e.flag}: ${e.message}`);
  }
}

// 4. generated files up to date
for (const [file, content] of Object.entries(expectedFiles(root))) {
  if (readIfExists(path.join(root, file)) !== content) errors.push(`${file} is out of date: run npm run flags:docs and commit the result`);
}

// FR-31
for (const f of unreferenced(REGISTRY, readers)) warnings.push(`${f.rule} ${f.message}`);

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
console.log(`flags:check: ${REGISTRY.length} registered names, ${PROFILE_NAMES.length} profiles, ${scanSource(readers).length} names read in ${readers.length} files, ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
