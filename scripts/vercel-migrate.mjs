// Runs during the Vercel build. `prisma migrate deploy` always takes a Postgres advisory lock, and on
// the pooled Prisma Postgres endpoint a stale lock holder makes it time out (P1002) — failing deploys
// that don't even contain a migration. `prisma migrate status` is read-only, so check it first and
// only run `migrate deploy` when something is actually pending.
//
// Fail-closed: anything other than a clean "up to date" answer (pending migrations, a failed earlier
// migration, a connection error, unexpected output) falls through to `migrate deploy`, which is exactly
// what the build did before — so a genuine migration still runs, and still fails loudly if it can't.
import { spawnSync } from "node:child_process";

// Once DATABASE_URL is the least-privilege app role (scripts/db/setup-app-role.mjs), only the owner in
// DIRECT_DATABASE_URL can run migrations — fail with a clear message instead of a "permission denied".
if (!process.env.DIRECT_DATABASE_URL && /^postgres(ql)?:\/\/supportify_app[:@]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("[vercel-migrate] DATABASE_URL is the restricted supportify_app role — set DIRECT_DATABASE_URL to the owner connection so migrations can run.");
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL };

const status = spawnSync("npx", ["prisma", "migrate", "status"], { env, encoding: "utf8" });
const output = `${status.stdout ?? ""}${status.stderr ?? ""}`;

if (status.status === 0 && output.includes("Database schema is up to date!")) {
  console.log("[vercel-migrate] No pending migrations — skipping `prisma migrate deploy`.");
  process.exit(0);
}

console.log("[vercel-migrate] Migrations pending or status unclear — running `prisma migrate deploy`.");
const deploy = spawnSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
process.exit(deploy.status ?? 1);
