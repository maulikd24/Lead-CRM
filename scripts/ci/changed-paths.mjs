#!/usr/bin/env node
// Writes `code`, `db`, `ui`, `layout` (true/false) to $GITHUB_OUTPUT (or stdout) from the files this PR changes.
// Needs no npm install (it runs first). On push, or when no base is given, everything is true. Usage: node scripts/ci/changed-paths.mjs [<base-ref>]
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { classify } from "./lib/changed.mjs";

const base = process.argv[2];
let result = { code: true, db: true, ui: true, layout: true };
if (base) {
  const r = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" });
  if (r.status === 0) result = classify(r.stdout.split("\n").filter(Boolean));
  else console.error(`changed-paths: could not diff against ${base}; running everything`);
}
const lines = Object.entries(result).map(([k, v]) => `${k}=${v}`);
console.log(lines.join(" "));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
