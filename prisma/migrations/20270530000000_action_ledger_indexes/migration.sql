-- Action Ledger (read model). Additive only: two indexes so the ledger's per-customer lookups are indexed seeks, not scans. No table, no column, no foreign key.
-- The ledger itself is assembled on read from records that already exist; nothing is stored for it.

-- "all tasks of one customer, newest first" (Task had no customer index)
CREATE INDEX "Task_clientId_createdAt_idx" ON "Task"("clientId", "createdAt");

-- "model runs about one subject, newest first" (AgentRun is keyed by correlation id, purpose and agent, not by subject)
CREATE INDEX "AgentRun_subjectType_subjectId_createdAt_idx" ON "AgentRun"("subjectType", "subjectId", "createdAt");
