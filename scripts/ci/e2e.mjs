#!/usr/bin/env node
// Role-based e2e, the same command locally and in CI (gate G11).
//   npm run ci:e2e                      scratch DB (wt_ci_e2e) -> migrate -> seed -> build with all-on flags if needed -> playwright
//   npm run ci:e2e -- --project=rm      extra arguments go to `playwright test`
//   flags: --no-build  use the .next already there (CI downloads the build artefact)   --clean  delete .next afterwards
//          --keep-db   keep the scratch DB   --axe  also run the accessibility project (nightly)
// Env: E2E_PORT (default 3100), E2E_PASSWORD (the seed password by default), CI_PGPORT/CI_PGHOST/CI_PGUSER.
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { PREFIX, createDb, dropDb, prisma, run, urlFor } from "./lib/db.mjs";

const root = process.cwd();
const argv = process.argv.slice(2);
const own = new Set(["--no-build", "--clean", "--keep-db", "--axe"]);
const pass = argv.filter((a) => !own.has(a));
const has = (f) => argv.includes(f);
const DB = `${PREFIX}e2e`;
const sh = (cmd, args, env = {}) => run(cmd, args, { cwd: root, env, stdio: "inherit" });

let code = 1;
try {
  console.log(`e2e: scratch database ${DB}`);
  await createDb(DB);
  const m = prisma(["migrate", "deploy"], DB);
  if (m.status !== 0) throw new Error(`migrate failed:\n${(m.stderr || m.stdout).slice(-1500)}`);
  const seed = sh("npx", ["tsx", "prisma/seed-e2e.ts"], { DATABASE_URL: urlFor(DB) });
  if (seed.status !== 0) throw new Error("seed-e2e failed");

  if (!has("--no-build") && !existsSync(path.join(root, ".next/BUILD_ID"))) {
    console.log("e2e: building with ci/flags-all-on.env (first run; takes about a minute)");
    const b = sh("node", ["scripts/ci/with-env.mjs", "ci/flags-all-on.env", "--", "npx", "next", "build"], { DATABASE_URL: urlFor(DB) });
    if (b.status !== 0) throw new Error("build failed");
  }
  if (!existsSync(path.join(root, ".next/BUILD_ID"))) throw new Error("no build found in .next (run without --no-build)");

  const r = run("npx", ["playwright", "test", ...pass], {
    cwd: root, stdio: "inherit",
    env: { DATABASE_URL: urlFor(DB), E2E_SERVER: "start", E2E_PORT: process.env.E2E_PORT ?? "3100", ...(has("--axe") ? { E2E_AXE: "1" } : {}) },
  });
  code = r.status;
} catch (e) {
  console.error(String(e?.message ?? e));
} finally {
  if (!has("--keep-db")) await dropDb(DB);
  if (has("--clean")) rmSync(path.join(root, ".next"), { recursive: true, force: true });
}
process.exit(code);
