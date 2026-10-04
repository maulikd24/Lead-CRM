// Creates/refreshes the least-privilege runtime role the app connects as, and checks it.
//
//   Owner role (DIRECT_DATABASE_URL)  owns every table, runs `prisma migrate deploy`. Never used at runtime.
//   App role   (supportify_app)       DATABASE_URL at runtime. Plain DML on business tables; on AuditLog
//                                      INSERT + SELECT only; read-only on the chain head and migration table.
//                                      Not the owner, so it cannot DISABLE TRIGGER, DROP or ALTER anything.
//
// Usage (run as the owner; idempotent, safe to re-run after every migration that adds tables):
//   DIRECT_DATABASE_URL=... APP_DB_PASSWORD=... node scripts/db/setup-app-role.mjs setup
//   APP_DATABASE_URL=postgres://supportify_app:...@host/db node scripts/db/setup-app-role.mjs check
//
// Local `prisma dev` (PGlite) ignores the username and can't switch roles, so `check` can't be run against
// it — test against a real Postgres instead.
import "dotenv/config";
import pg from "pg";

const ROLE = "supportify_app";
const mode = process.argv[2];

async function connect(url, label) {
  if (!url) throw new Error(`${label} is not set`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function setup() {
  const password = process.env.APP_DB_PASSWORD;
  if (!password || password.length < 24) throw new Error("APP_DB_PASSWORD must be set (24+ characters)");
  const db = await connect(process.env.DIRECT_DATABASE_URL, "DIRECT_DATABASE_URL");
  const { rows: [{ owner }] } = await db.query(`SELECT current_user AS owner`);
  const ownerIdent = db.escapeIdentifier(owner);

  await db.query("BEGIN");
  try {
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE}; END IF;
    END $$`);
    // Only LOGIN + password: a non-superuser owner (the norm on managed Postgres) may not even *state*
    // NOSUPERUSER/NOBYPASSRLS. New roles get the safe defaults anyway; `check` asserts them.
    await db.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD ${db.escapeLiteral(password)}`);
    await db.query(`DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${ROLE}', current_database()); END $$`);
    await db.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await db.query(`REVOKE CREATE ON SCHEMA public FROM ${ROLE}`);

    await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
    await db.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);
    // Tables created by future migrations (run by this same owner) get the same plain-DML grant.
    await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdent} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`);
    await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdent} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`);

    // The exceptions. Re-applied on every run so a broad GRANT above can never widen them.
    await db.query(`REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM ${ROLE}`);
    await db.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "AuditLogChainHead" FROM ${ROLE}`);
    await db.query(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "_prisma_migrations" FROM ${ROLE}`);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
  console.log(`[setup-app-role] ${ROLE} ready (owner: ${owner}). Now run the "check" mode with APP_DATABASE_URL.`);
}

// Each probe runs in its own rolled-back transaction, so check never leaves anything behind.
async function check() {
  const db = await connect(process.env.APP_DATABASE_URL, "APP_DATABASE_URL");
  const results = [];
  async function probe(name, sql, expect) {
    await db.query("BEGIN");
    let detail = "allowed";
    try {
      await db.query(sql);
    } catch (error) {
      detail = error.message;
    } finally {
      await db.query("ROLLBACK");
    }
    results.push({ ok: (detail === "allowed") === (expect === "allowed"), name, expect, detail });
  }

  const { rows: [who] } = await db.query(
    `SELECT current_user AS role, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = current_user`,
  );
  const elevated = ["rolsuper", "rolcreaterole", "rolcreatedb", "rolbypassrls", "rolreplication"].filter((attr) => who[attr]);
  results.push({ ok: who.role === ROLE && elevated.length === 0, name: "connected as app role, no elevated attrs", expect: ROLE, detail: `${who.role}${elevated.length ? ` has ${elevated.join(", ")}` : ""}` });

  const { rows: [user] } = await db.query(`SELECT id FROM "User" LIMIT 1`);
  await probe("insert audit entry", `INSERT INTO "AuditLog"(id, "userId", entity, "entityId", action) VALUES ('role_check_${Date.now()}', '${user.id}', 'RoleCheck', 'x', 'role_check')`, "allowed");
  await probe("verify audit chain", `SELECT * FROM audit_log_verify()`, "allowed");
  await probe("update audit entry", `UPDATE "AuditLog" SET reason = 'x' WHERE seq = 1`, "denied");
  await probe("delete audit entry", `DELETE FROM "AuditLog" WHERE seq = 1`, "denied");
  await probe("truncate audit log", `TRUNCATE "AuditLog"`, "denied");
  await probe("disable audit triggers", `ALTER TABLE "AuditLog" DISABLE TRIGGER USER`, "denied");
  await probe("drop audit trigger", `DROP TRIGGER "AuditLog_no_update_delete" ON "AuditLog"`, "denied");
  await probe("replace verify function", `CREATE OR REPLACE FUNCTION audit_log_verify() RETURNS TABLE (seq BIGINT, id TEXT, problem TEXT) LANGUAGE sql AS 'SELECT NULL::bigint, NULL::text, NULL::text WHERE false'`, "denied");
  await probe("move chain head", `UPDATE "AuditLogChainHead" SET seq = 0`, "denied");
  await probe("create table", `CREATE TABLE role_check_tmp (id int)`, "denied");
  await probe("write migrations table", `DELETE FROM "_prisma_migrations"`, "denied");
  await probe("read migrations table", `SELECT 1 FROM "_prisma_migrations" LIMIT 1`, "allowed");
  await probe("normal app write", `UPDATE "User" SET "updatedAt" = "updatedAt" WHERE false`, "allowed");
  await db.end();

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(40)} expected ${r.expect.padEnd(14)} → ${r.detail}`);
  if (results.some((r) => !r.ok)) process.exit(1);
}

if (mode === "setup") await setup();
else if (mode === "check") await check();
else {
  console.error("Usage: node scripts/db/setup-app-role.mjs <setup|check>");
  process.exit(2);
}
