// Runs during the Vercel build. `prisma migrate deploy` always takes a Postgres advisory lock, and on
// the pooled Prisma Postgres endpoint a stale lock holder makes it time out (P1002) — failing deploys
// that don't even contain a migration. `prisma migrate status` is read-only, so check it first and
// only run `migrate deploy` when something is actually pending.
//
// Fail-closed: anything other than a clean "up to date" answer (pending migrations, a failed earlier
// migration, a connection error, unexpected output) falls through to `migrate deploy`, which is exactly
// what the build did before — so a genuine migration still runs, and still fails loudly if it can't.
import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

// A Preview deployment with no database configured has nothing to migrate: skip, and let `next build` still
// run as a compile check instead of failing every branch's deploy. Production must have one — fail loudly.
// Give Preview its own database (never Production's: previews run unmerged migrations) to get working previews.
if (!databaseUrl) {
  if (process.env.VERCEL_ENV === "production") {
    console.error("[vercel-migrate] No DATABASE_URL / DIRECT_DATABASE_URL in Production — refusing to build without migrations.");
    process.exit(1);
  }
  console.warn(`[vercel-migrate] No database configured for this ${process.env.VERCEL_ENV ?? "local"} build — skipping migrations (build only).`);
  process.exit(0);
}

// Once DATABASE_URL is the least-privilege app role (scripts/db/setup-app-role.mjs), only the owner in
// DIRECT_DATABASE_URL can run migrations — fail with a clear message instead of a "permission denied".
if (!process.env.DIRECT_DATABASE_URL && /^postgres(ql)?:\/\/supportify_app[:@]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("[vercel-migrate] DATABASE_URL is the restricted supportify_app role — set DIRECT_DATABASE_URL to the owner connection so migrations can run.");
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: databaseUrl };

const status = spawnSync("npx", ["prisma", "migrate", "status"], { env, encoding: "utf8" });
const output = `${status.stdout ?? ""}${status.stderr ?? ""}`;

if (status.status === 0 && output.includes("Database schema is up to date!")) {
  console.log("[vercel-migrate] No pending migrations — skipping `prisma migrate deploy`.");
  process.exit(0);
}

// Known-safe recoveries only. A failed migration blocks every later deploy (P3009) until it is resolved, which
// normally needs someone with the production database credentials. These names were fixed in place and are safe
// to re-run, so the build marks them rolled back and lets `migrate deploy` apply the corrected version.
// Never add a migration here unless its SQL is idempotent — any other failure must still stop the build.
const RECOVERABLE_FAILED_MIGRATIONS = [
  // Failed on Prisma Postgres ("restricted superuser cannot grant or revoke privileges"); REVOKEs removed.
  "20261009000000_audit_chain_security_definer",
];
for (const name of RECOVERABLE_FAILED_MIGRATIONS) {
  if (/failed/i.test(output) && output.includes(name)) {
    console.log(`[vercel-migrate] Recovering known failed migration ${name} — marking it rolled back so the fixed version re-applies.`);
    const resolve = spawnSync("npx", ["prisma", "migrate", "resolve", "--rolled-back", name], { env, stdio: "inherit" });
    if (resolve.status !== 0) process.exit(resolve.status ?? 1);
  }
}

console.log("[vercel-migrate] Migrations pending or status unclear — running `prisma migrate deploy`.");
const deploy = spawnSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
process.exit(deploy.status ?? 1);
