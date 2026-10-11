#!/usr/bin/env node
// Run a command with the variables of an env file added:  node scripts/ci/with-env.mjs ci/flags-all-on.env -- next build
// (`--` separates the file from the command). Existing environment variables win, so a job can still override a flag.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 1 || sep === argv.length - 1) { console.error("usage: with-env.mjs <env-file> [<env-file> ...] -- <command> [args]"); process.exit(2); }
const env = { ...process.env };
for (const file of argv.slice(0, sep)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && !(m[1] in process.env)) env[m[1]] = m[2];
  }
}
const [cmd, ...rest] = argv.slice(sep + 1);
process.exit(spawnSync(cmd, rest, { stdio: "inherit", env }).status ?? 1);
