-- Prepare the AuditLog chain for a least-privilege app role (scripts/db/setup-app-role.mjs).
--
-- The chain trigger updates "AuditLogChainHead". Running it as its owner (the migration role) means the
-- app role needs no write access to the head at all — it can only move forward through an AuditLog
-- insert. search_path is pinned so a SECURITY DEFINER function can't be hijacked via a lookalike object.
-- Safe to apply whether or not the app role exists yet.
ALTER FUNCTION audit_log_chain_insert() SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON "AuditLogChainHead" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM PUBLIC;
