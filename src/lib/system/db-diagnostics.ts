import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

export type DbUrlSummary = { configured: boolean; host: string | null; database: string | null; credentialsFingerprint: string | null };

/** Host and database name only, plus a short hash of user+password so two URLs can be compared without revealing either. */
function summarizeUrl(raw: string | undefined): DbUrlSummary {
  if (!raw) return { configured: false, host: null, database: null, credentialsFingerprint: null };
  try {
    const url = new URL(raw);
    
    const fingerprint = createHash("sha256").update(`${url.username}:${url.password}`).digest("hex").slice(0, 8);
    return { configured: true, host: url.hostname, database: url.pathname.replace(/^\//, "") || null, credentialsFingerprint: fingerprint };
  } catch {
    return { configured: true, host: null, database: null, credentialsFingerprint: null };
  }
}

export type DbDiagnostics = {
  runtime: DbUrlSummary;
  direct: DbUrlSummary;
  connectedDatabase: string | null;
  whatsappTableExists: boolean | null;
  /** Role the app is connected as, and whether it could get round AuditLog's append-only protection
   * (UPDATE/DELETE grants, or owning the table and so being able to disable its triggers). */
  auditProtection: { role: string; canTamper: boolean } | null;
  recentMigrations: { name: string; finishedAt: Date | null; rolledBackAt: Date | null }[] | null;
  error: string | null;
};

/** Read-only look at which database the running app is actually connected to and what state its migrations are in. */
export async function getDbDiagnostics(): Promise<DbDiagnostics> {
  const result: DbDiagnostics = {
    runtime: summarizeUrl(process.env.DATABASE_URL),
    direct: summarizeUrl(process.env.DIRECT_DATABASE_URL),
    connectedDatabase: null,
    whatsappTableExists: null,
    auditProtection: null,
    recentMigrations: null,
    error: null,
  };
  try {
    const db = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    result.connectedDatabase = db[0]?.name ?? null;
    const table = await prisma.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('public."WhatsAppAccount"') IS NOT NULL AS present`;
    result.whatsappTableExists = table[0]?.present ?? null;
    const audit = await prisma.$queryRaw<{ role: string; can_tamper: boolean }[]>`
      SELECT current_user AS role,
             has_table_privilege('"AuditLog"', 'UPDATE') OR has_table_privilege('"AuditLog"', 'DELETE')
               OR pg_has_role((SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'AuditLog'), 'MEMBER')
               AS can_tamper`;
    result.auditProtection = audit[0] ? { role: audit[0].role, canTamper: audit[0].can_tamper } : null;
    const migrations = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 5`;
    result.recentMigrations = migrations.map((m) => ({ name: m.migration_name, finishedAt: m.finished_at, rolledBackAt: m.rolled_back_at }));
  } catch (error) {
    result.error = error instanceof Error ? error.message.slice(0, 300) : "Diagnostics query failed";
  }
  return result;
}
